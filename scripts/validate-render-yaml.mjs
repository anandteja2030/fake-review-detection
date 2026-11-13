#!/usr/bin/env node
/**
 * Validate render.yaml against Render's published Blueprint JSON Schema.
 *
 *   node scripts/validate-render-yaml.mjs                # checks ./render.yaml
 *   node scripts/validate-render-yaml.mjs path/to.yaml   # checks another file
 *   node scripts/validate-render-yaml.mjs --update-schema  # refresh the copy
 *
 * The schema is vendored at scripts/schema/render.yaml.schema.json so CI is
 * deterministic and runs offline. Render adds fields over time: when a new,
 * legitimate field is reported as unexpected, refresh deliberately with
 * --update-schema and commit the result. Canonical source:
 * https://render.com/schema/render.yaml.json (draft 2020-12).
 *
 * Exit codes: 0 = valid, 1 = invalid YAML or schema violations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCounter, parseDocument } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(HERE, 'schema', 'render.yaml.schema.json');
const SCHEMA_URL = 'https://render.com/schema/render.yaml.json';

const args = process.argv.slice(2);
const updateSchema = args.includes('--update-schema');
const target = args.find((a) => !a.startsWith('--')) || 'render.yaml';

async function refreshSchema() {
  const res = await fetch(SCHEMA_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${SCHEMA_URL} -> HTTP ${res.status}`);
  const text = await res.text();
  JSON.parse(text); // never cache a broken download
  fs.mkdirSync(path.dirname(SCHEMA_PATH), { recursive: true });
  fs.writeFileSync(SCHEMA_PATH, text.endsWith('\n') ? text : `${text}\n`);
  console.log(`refreshed ${path.relative(process.cwd(), SCHEMA_PATH)} from ${SCHEMA_URL}`);
}

/** "/services/0/plan" -> ['services', 0, 'plan'] */
function pointerToPath(pointer) {
  if (!pointer) return [];
  return pointer
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map((raw) => raw.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

/** Best-effort line/column for a failing path, walking up to the nearest node. */
function locate(doc, lineCounter, pointer) {
  const segments = pointerToPath(pointer);
  for (let n = segments.length; n >= 0; n -= 1) {
    const node = n === 0 ? doc.contents : doc.getIn(segments.slice(0, n), true);
    if (node && Array.isArray(node.range)) {
      const { line, col } = lineCounter.linePos(node.range[0]);
      return { line, col };
    }
  }
  return null;
}

const MAX_SHOWN = 10;

/**
 * A union schema (`anyOf` over service types) reports the same typo once per
 * branch, plus a generic "must match a schema in anyOf" summary. Collapse the
 * duplicates and drop those summaries so the first lines a developer reads are
 * the actual mistake instead of branch noise.
 */
function summarize(errors) {
  const seen = new Set();
  const unique = [];
  for (const error of errors) {
    const key = [
      error.instancePath, error.keyword, error.message,
      error.params?.additionalProperty ?? '',
      (error.params?.allowedValues ?? []).join('|')
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(error);
  }
  const specific = unique.filter((e) => e.keyword !== 'anyOf');
  return specific.length > 0 ? specific : unique;
}

function explain(error) {
  const allowed = error.params?.allowedValues;
  if (Array.isArray(allowed)) return `${error.message} — allowed: ${allowed.join(', ')}`;
  if (error.params?.additionalProperty) return `${error.message}: ${error.params.additionalProperty}`;
  const expected = error.params?.type ? ` (expected ${[].concat(error.params.type).join(' | ')})` : '';
  return `${error.message}${expected}`;
}

async function main() {
  if (updateSchema) await refreshSchema();
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`missing ${path.relative(process.cwd(), SCHEMA_PATH)}; run with --update-schema`);
  }
  if (!fs.existsSync(target)) throw new Error(`no such file: ${target}`);

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const source = fs.readFileSync(target, 'utf8');

  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  if (doc.errors.length > 0) {
    console.error(`${target}: YAML syntax error`);
    for (const err of doc.errors) console.error(`  ${err.message}`);
    return 1;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);
  if (validate(doc.toJS())) {
    console.log(`${target}: valid against the Render Blueprint schema (${SCHEMA_URL})`);
    return 0;
  }

  const all = validate.errors ?? [];
  const errors = summarize(all);
  console.error(`${target}: ${errors.length} schema violation${errors.length === 1 ? '' : 's'}`);
  for (const error of errors.slice(0, MAX_SHOWN)) {
    const at = locate(doc, lineCounter, error.instancePath);
    const where = at ? ` (line ${at.line}, column ${at.col})` : '';
    console.error(`  ${error.instancePath || '(root)'}${where}: ${explain(error)}`);
  }
  if (errors.length > MAX_SHOWN) console.error(`  … and ${errors.length - MAX_SHOWN} more`);
  if (all.some((e) => e.keyword === 'anyOf')) {
    console.error('\nHint: a rejected `type` or `plan` value makes every service variant fail at');
    console.error('once, so some lines are branch noise — fix the most specific error first.');
  }
  console.error('Render Blueprint reference: https://render.com/docs/blueprint-spec');
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`render schema check failed: ${err.message}`);
    process.exit(1);
  });
