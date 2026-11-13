import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// No YAML parser is installed in this project, so the blueprint is checked
// structurally: exact service blocks, required keys, indentation and the
// absence of tabs (a tab is invalid YAML and would break the Render deploy).
const yaml = fs.readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');
const lines = yaml.split(/\r?\n/);
const uncommented = lines.filter((l) => !l.trim().startsWith('#'));

function block(name) {
  const start = lines.findIndex((l) => l.trim() === `name: ${name}`);
  assert.ok(start > -1, `${name} service is declared`);
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i > start && /^\s{2}-\s+type:\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

test('render.yaml is tab-free and declares exactly two web services', () => {
  assert.equal(yaml.includes('\t'), false, 'YAML must not contain tab characters');
  assert.match(yaml, /^services:\s*$/m);
  assert.equal((yaml.match(/^\s{2}- type: web\s*$/gm) || []).length, 2);
  assert.ok(yaml.includes('name: frd-ml'));
  assert.ok(yaml.includes('name: frd-api'));
});

test('ML service: Python 3.12, 2 GB plan, ml/ root, uvicorn on $PORT', () => {
  const ml = block('frd-ml');
  assert.match(ml, /runtime: python/);
  assert.match(ml, /plan: standard/);
  assert.doesNotMatch(ml, /plan: free/, 'the 512 MB instance is not usable for the model');
  assert.match(ml, /rootDir: ml/);
  assert.match(ml, /healthCheckPath: \/health/);
  assert.match(ml, /startCommand: uvicorn serve:app --host 0\.0\.0\.0 --port \$PORT/);
  assert.match(ml, /value: "3\.12\.5"/);
  assert.match(ml, /key: MODEL_DIR/);
  assert.match(ml, /value: all-MiniLM-L6-v2/);
});

test('ML build uses CPU torch and the portable requirements file', () => {
  const ml = block('frd-ml');
  // Only executable lines: the block's comments legitimately mention the
  // Windows freeze that must NOT be installed here.
  const executable = ml.replace(/^\s*#.*$/gm, '');
  assert.match(executable, /download\.pytorch\.org\/whl\/cpu/);
  assert.match(executable, /torch==2\.15\.0/);
  assert.match(executable, /pip install -r requirements\.txt/);
  assert.doesNotMatch(executable, /requirements\.lock\.txt/, 'the Windows x64 freeze must not build a Linux service');
  assert.match(executable, /vader_lexicon/, 'VADER is pre-downloaded at build time');
});

test('API service: Node 20, root install, explicit start, health check', () => {
  const api = block('frd-api');
  assert.match(api, /runtime: node/);
  assert.match(api, /plan: free/, 'the API stays on the free instance');
  assert.match(api, /rootDir: \./);
  assert.match(api, /buildCommand: npm ci/);
  assert.match(api, /startCommand: node server\/src\/server\.js/);
  assert.match(api, /healthCheckPath: \/api\/health/);
  assert.match(api, /value: "20"/);
  assert.match(api, /key: ML_ADAPTER_MODE/);
  assert.match(api, /value: python-http/);
  assert.match(api, /key: ML_REQUEST_TIMEOUT_MS/);
  assert.match(api, /numInstances: 1/);
});

test('ML_SERVICE_URL is a manual dashboard value and storage stays opt-in', () => {
  const apiLines = block('frd-api').split('\n');
  const i = apiLines.findIndex((l) => l.includes('key: ML_SERVICE_URL'));
  assert.ok(i > -1);
  assert.match(apiLines[i + 1], /sync: false/, 'the remote ML URL must be entered in Render');
  const o = apiLines.findIndex((l) => l.includes('key: ALLOWED_ORIGINS'));
  assert.ok(o > -1);
  assert.match(
    apiLines[o + 1],
    /value: https:\/\/anandteja2030\.github\.io/,
    'the GitHub Pages origin ships in the blueprint so CORS works without a manual step'
  );
  assert.doesNotMatch(apiLines[o + 1], /sync: false/);
  assert.equal(
    uncommented.some((l) => /^\s*disk:/.test(l)),
    false,
    'no paid persistent disk is enabled automatically'
  );
});
