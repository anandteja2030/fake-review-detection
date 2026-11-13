#!/usr/bin/env node
/**
 * End-to-end smoke check for the deployed Render pair.
 *
 *   node scripts/smoke-render.mjs --api https://frd-api.onrender.com --ml https://frd-ml.onrender.com
 *   SMOKE_API_BASE=... SMOKE_ML_BASE=... node scripts/smoke-render.mjs
 *
 * Checks, in order:
 *   1. GET  {api}/api/health           — the API is up (waits out a cold start).
 *   2. GET  {ml}/health                — the ML service is up, artifacts loaded.
 *   3. GET  {api}/api/model/status     — the API is wired to the ML service.
 *   4. POST {api}/api/analyze          — a REAL prediction with valid evidence.
 *   5. POST {api}/api/analyze (bad)    — invalid input is rejected, not predicted.
 *   6. Unreachable ML fails honestly   — a local instance of the same server,
 *      pointed at a host that cannot resolve, must fail with a 5xx and must not
 *      invent a prediction, evidence, or a history record.
 *
 * Step 6 runs the checked-in server code against a dead ML URL, because a
 * deployed API's ML_SERVICE_URL cannot be changed from outside; it proves the
 * failure contract the deploy relies on. Skip it with --skip-failure-check.
 *
 * Exit code 0 = every check passed. Any failure exits 1 and names the check.
 * Nothing is written to the deployed services except one analyze request (and
 * the history record that request legitimately creates).
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REVIEW = 'The kettle boils quickly and the lid fits tightly. I have used it every morning for two weeks.';
// RFC 2606 reserves .invalid: it can never resolve, so the failure is
// deterministic and offline. It is also NOT loopback, so the API will never
// try to spawn a local Python engine for it.
const DEAD_ML_URL = 'http://unreachable.invalid:9/predict';
const FAILURE_CODES = ['ML_SERVICE_UNREACHABLE', 'ML_SERVICE_TIMEOUT', 'ML_SERVICE_ERROR'];

function usage() {
  console.log(`Usage: node scripts/smoke-render.mjs --api <url> [options]

  --api <url>              Deployed API base, e.g. https://frd-api.onrender.com
                           (a trailing /api is accepted). Env: SMOKE_API_BASE
  --ml <url>               Deployed ML base, e.g. https://frd-ml.onrender.com
                           Optional, but then step 2 is skipped. Env: SMOKE_ML_BASE
  --timeout <seconds>      Cold-start budget per service (default 120).
  --skip-failure-check     Skip step 6 (the local unreachable-ML check).
  -h, --help               Show this help.

Before running, the Render dashboard needs:
  frd-api  ML_SERVICE_URL = https://<frd-ml host>/predict   (must end in /predict)
  frd-api  ALLOWED_ORIGINS = the exact frontend origin
`);
}

function parseArgs(argv) {
  const opts = {
    api: process.env.SMOKE_API_BASE || '',
    ml: process.env.SMOKE_ML_BASE || '',
    timeout: 120,
    failureCheck: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--api') {
      opts.api = argv[++i] || '';
    } else if (arg === '--ml') {
      opts.ml = argv[++i] || '';
    } else if (arg === '--timeout') {
      opts.timeout = Number(argv[++i]);
    } else if (arg === '--skip-failure-check') {
      opts.failureCheck = false;
    } else {
      throw new Error(`unknown option: ${arg} (see --help)`);
    }
  }
  if (!opts.api) throw new Error('--api <url> is required (or set SMOKE_API_BASE; see --help)');
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) throw new Error('--timeout must be a positive number of seconds');
  return opts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function baseUrl(raw) {
  const trimmed = String(raw).trim().replace(/\/+$/, '');
  try {
    new URL(trimmed);
  } catch {
    throw new Error(`not a valid URL: ${raw}`);
  }
  return trimmed;
}

/** Accept both https://host and https://host/api for the API base. */
function apiRoot(raw) {
  const base = baseUrl(raw);
  return /\/api$/.test(base) ? base : `${base}/api`;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function describeFetchError(err) {
  const code = err?.cause?.code || err?.code;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `timed out (${code || 'AbortSignal'})`;
  return code ? `${code}: ${err.message}` : err?.message || 'network error';
}

async function request(url, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new Error(`${method} ${url} failed: ${describeFetchError(err)}`);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* a proxy/HTML error page: keep the raw text for diagnostics */
  }
  return { status: res.status, json, text };
}

/** Poll until the probe answers 200, so a Render cold start is not a failure. */
async function waitForReady(probe, budgetMs, label) {
  const deadline = Date.now() + budgetMs;
  let last = 'no response yet';
  for (;;) {
    try {
      const res = await probe();
      if (res.status === 200) return res;
      last = `HTTP ${res.status}${res.json?.error ? ` ${res.json.error}` : ''}`;
    } catch (err) {
      last = err.message;
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} not ready within ${Math.round(budgetMs / 1000)}s (last: ${last})`);
    }
    await sleep(3000);
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const results = [];
let warnings = 0;

function warn(text) {
  warnings += 1;
  console.log(`⚠ ${text}`);
}

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name}${detail ? ` — ${detail}` : ''}  (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`✖ ${name} — ${err.message}`);
  }
}

/**
 * Step 6: run THIS repository's server against an ML host that cannot resolve
 * and prove it fails honestly instead of inventing a prediction.
 */
async function expectHonestFailure() {
  const port = await freePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frd-smoke-'));
  const historyFile = path.join(tmpDir, 'prediction_history.json');
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ML_ADAPTER_MODE: 'python-http',
      ML_SERVICE_URL: DEAD_ML_URL,
      ML_MAX_RETRIES: '0',
      ML_RETRY_BASE_MS: '100',
      ML_REQUEST_TIMEOUT_MS: '5000',
      AFRD_HISTORY_FILE: historyFile
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const logs = [];
  const collect = (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 40) logs.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const local = `http://127.0.0.1:${port}/api`;
  try {
    await waitForReady(() => request(`${local}/health`, { timeoutMs: 4000 }), 30000, 'local API (failure check)');
    const { status, json } = await request(`${local}/analyze`, {
      method: 'POST',
      body: { text: REVIEW, rating: 5 },
      timeoutMs: 30000
    });
    const code = json?.error;
    expect(status >= 500, `expected a 5xx when the ML service is unreachable, got HTTP ${status}`);
    expect(
      FAILURE_CODES.includes(code),
      `expected one of ${FAILURE_CODES.join('/')}, got ${JSON.stringify(code)}${json?.message ? ` ("${json.message}")` : ''}`
    );
    expect(json?.prediction === undefined, 'a prediction was fabricated while the ML service was unreachable');
    expect(json?.probabilities === undefined, 'probabilities were fabricated while the ML service was unreachable');
    expect(json?.evidence === undefined, 'evidence was fabricated while the ML service was unreachable');

    let recorded = 0;
    if (fs.existsSync(historyFile)) {
      try {
        recorded = JSON.parse(fs.readFileSync(historyFile, 'utf8')).length;
      } catch {
        recorded = -1;
      }
    }
    expect(recorded === 0, recorded === -1
      ? 'history file written but unreadable after a failed prediction'
      : `${recorded} history record(s) written for a prediction that never happened`);

    return `HTTP ${status} ${code}, no prediction, no evidence, no history`;
  } catch (err) {
    const tail = logs.join('').trim().split('\n').slice(-3).join(' | ');
    throw new Error(`${err.message}${tail ? `\n    server: ${tail}` : ''}`);
  } finally {
    child.kill();
    await Promise.race([once(child, 'exit'), sleep(5000)]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const api = apiRoot(opts.api);
  const ml = opts.ml ? baseUrl(opts.ml) : null;
  const started = Date.now();

  console.log(`Smoke checking ${api}${ml ? ` + ${ml}` : ''}\n`);

  await check('API health', async () => {
    const { json } = await waitForReady(() => request(`${api}/health`, { timeoutMs: 15000 }), opts.timeout * 1000, 'API /api/health');
    expect(json?.status === 'ok', `unexpected body: ${String(json ? JSON.stringify(json) : '').slice(0, 160)}`);
    return json.service || 'ok';
  });

  if (ml) {
    await check('ML service health', async () => {
      const res = await waitForReady(async () => {
        const probe = await request(`${ml}/health`, { timeoutMs: 15000 });
        // 200 with artifacts still loading is not ready yet.
        return probe.json?.artifactsLoaded === false ? { ...probe, status: 503 } : probe;
      }, opts.timeout * 1000, 'ML /health');
      return res.json?.artifactsLoaded === true ? 'artifacts loaded' : 'reachable (artifactsLoaded not reported)';
    });
  }

  await check('API is wired to the ML service', async () => {
    const { status, json } = await request(`${api}/model/status`, { timeoutMs: 15000 });
    expect(status === 200, `HTTP ${status}`);
    expect(json?.adapterMode === 'python-http', `ML_ADAPTER_MODE is ${JSON.stringify(json?.adapterMode)}; a deployed API needs "python-http"`);
    expect(json?.connected === true, 'the API reports the ML service as not connected');
    expect(typeof json?.serviceUrl === 'string' && json.serviceUrl.length > 0, 'ML_SERVICE_URL is not set on the API');
    if (json.transport === 'local-http') {
      warn(`ML_SERVICE_URL is ${json.serviceUrl} (loopback) — on Render it must be the frd-ml https URL ending in /predict`);
    }
    return `${json.serviceUrl} (timeout ${json.timeoutMs}ms, retries ${json.maxRetries})`;
  });

  await check('real prediction with evidence', async () => {
    const { status, json } = await request(`${api}/analyze`, {
      method: 'POST',
      body: { text: REVIEW, rating: 5 },
      timeoutMs: 120000
    });
    expect(status === 200, `HTTP ${status}${json?.error ? ` ${json.error}` : ''}${json?.message ? `: ${json.message}` : ''}`);
    expect(json?.status === 'model_connected', `status is ${JSON.stringify(json?.status)} — a 200 without the model is not a prediction`);
    expect(json?.prediction === 'fake' || json?.prediction === 'genuine', `non-binary verdict: ${JSON.stringify(json?.prediction)}`);
    const p = json?.probabilities || {};
    expect(typeof p.fake === 'number' && typeof p.genuine === 'number', 'missing numeric probabilities{fake,genuine}');
    expect(Math.abs(p.fake + p.genuine - 1) <= 1e-4, `probabilities sum to ${(p.fake + p.genuine).toFixed(4)}, not 1`);
    expect(p.suspicious === undefined, 'binary contract broken: a "suspicious" probability was returned');
    const ev = json?.evidence;
    expect(ev && typeof ev === 'object', 'no evidence object returned');
    expect(ev.reviewText === REVIEW, 'evidence belongs to a different review');
    expect(Array.isArray(ev.topEvidence) && ev.topEvidence.length > 0, 'evidence.topEvidence is empty');
    expect(Array.isArray(ev.measuredSignals) && ev.measuredSignals.length > 0, 'evidence.measuredSignals is empty');
    return `${json.prediction} (P(fake)=${p.fake.toFixed(3)}), ${ev.topEvidence.length} evidence item(s), threshold ${ev.threshold}`;
  });

  await check('invalid input is rejected, not predicted', async () => {
    const { status, json } = await request(`${api}/analyze`, {
      method: 'POST',
      body: { text: '   ', rating: 9 },
      timeoutMs: 15000
    });
    expect(status === 400, `expected HTTP 400, got ${status}`);
    expect(json?.error === 'INVALID_INPUT', `unexpected error code ${JSON.stringify(json?.error)}`);
    expect(json?.prediction === undefined, 'a rejected request carried a prediction');
    return `${json.error}: ${json.message}`;
  });

  if (opts.failureCheck) {
    await check('unreachable ML host fails honestly', expectHonestFailure);
  }

  const failed = results.filter((r) => !r.ok);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log('');
  if (failed.length === 0) {
    console.log(`PASS — ${results.length} check(s) in ${seconds}s${warnings ? `, ${warnings} warning(s)` : ''}`);
    return 0;
  }
  console.log(`FAIL — ${failed.length} of ${results.length} check(s) in ${seconds}s:`);
  for (const f of failed) console.log(`  ✖ ${f.name}: ${f.error}`);
  console.log('\nRender dashboard values to re-check: ML_SERVICE_URL (https, ends in /predict),');
  console.log('ALLOWED_ORIGINS (exact frontend origin). Build/deploy logs: frd-ml for artifacts, frd-api for wiring.');
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`smoke check failed to run: ${err.message}`);
    process.exit(1);
  });
