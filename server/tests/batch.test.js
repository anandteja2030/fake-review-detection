import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// The batch suite exercises the full metadata/response/history contract, so it
// runs against a LOCAL MOCK of the documented Python inference contract
// (POST /predict -> { label, probabilities{fake,genuine}, ... }).
// The mock only replaces the transport in tests — the real deployment talks to
// the trained FastAPI service (verified separately in E2E).
// Env must be set BEFORE importing app.js (adapter reads it at module load).
// ---------------------------------------------------------------------------
process.env.ML_ADAPTER_MODE = 'python-http';

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const { text } = JSON.parse(body || '{}');
    if (/SIMULATE_SERVICE_ERROR/i.test(text || '')) {
      res.statusCode = 500;
      res.end(JSON.stringify({ detail: 'injected failure' }));
      return;
    }
    const fake = /terrible|garbage|broke|trash|awful/i.test(text || '');
    const label = fake ? 'fake' : 'genuine';
    const pFake = fake ? 0.91 : 0.06;
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    // The mock mirrors the DOCUMENTED /predict contract, including the
    // per-review evidence object the real FastAPI service returns.
    const evidence = {
      version: 1,
      reviewText: text,
      threshold: 0.4738,
      topEvidence: [
        { id: 'decision', category: 'model',
          label: `Stacking ensemble verdict: ${label.toUpperCase()}`,
          detail: `P(fake) = ${pFake.toFixed(4)} vs decision threshold 0.4738 -> ${label.toUpperCase()}.` },
        { id: 'base-learners', category: 'model',
          label: 'Base-learner Fake probabilities (2/3 above 0.5)',
          detail: 'Logistic Regression 0.8500 · XGBoost 0.9300 · LightGBM 0.8900 feed the stacking meta-model.' }
      ],
      suspiciousWords: [],
      measuredSignals: [
        { key: 'review_length', label: 'Review length', value: words.length, unit: 'words',
          description: "Word count of the cleaned text - the model's review_length input feature.",
          available: true, unavailableReason: null }
      ],
      explanationSummary: `The model classified this ${words.length}-token review as ${label.toUpperCase()} (P(fake)=${pFake.toFixed(4)} against a decision threshold of 0.4738).`,
      limitations: [
        'Measured signals are inputs to the model and diagnostics on the text; they do not establish why the ensemble produced its verdict.',
        'Term-ablation attribution is a perturbation sensitivity measurement on this trained model - not SHAP, not LIME, and not a causal claim.',
        'The classifier detects statistical patterns in wording; it cannot verify whether any individual review is genuinely deceptive.'
      ],
      attribution: {
        method: null, status: 'unavailable',
        unavailableReason: 'The mock contract service does not run perturbation analysis.',
        description: 'Term-ablation sensitivity: each listed term is deleted from the submitted review text and the full model pipeline is re-run.',
        terms: []
      }
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      label,
      probabilities: fake ? { fake: 0.91, genuine: 0.09 } : { fake: 0.06, genuine: 0.94 },
      confidence: fake ? 0.91 : 0.94,
      trustScore: fake ? 9 : 94,
      riskLevel: fake ? 'high' : 'low',
      modelId: 'frd-stack-v1', modelVersion: '1.0.0',
      evidence
    }));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
process.env.ML_SERVICE_URL = `http://127.0.0.1:${mock.address().port}/predict`;

const TEST_HISTORY = path.join(os.tmpdir(), `afrd-batch-history-${process.pid}.json`);
process.env.AFRD_HISTORY_FILE = TEST_HISTORY;
fs.rmSync(TEST_HISTORY, { force: true });

const { createApp } = await import('../src/app.js');
const app = createApp();
let base;
let server;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(() => { server?.close(); mock.close(); fs.rmSync(TEST_HISTORY, { force: true }); });

const post = (p, body) => fetch(`${base}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('GET /categories returns the category vocabulary and batch limit', async () => {
  const res = await fetch(`${base}/categories`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Array.isArray(body.categories), true);
  assert.equal(body.categories.includes('Electronics'), true);
  assert.equal(body.categories.includes('Beauty and Skincare'), true);
  assert.equal(body.categories.includes('Other'), true);
  assert.equal(body.maxBatch >= 3, true);
});

test('batch rejects non-array, empty, and oversized requests', async () => {
  assert.equal((await post('/analyze/batch', { reviews: 'nope' })).status, 400);
  assert.equal((await post('/analyze/batch', { reviews: [] })).status, 400);
  const { MAX_BATCH } = await import('../src/services/batchService.js');
  const big = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ text: `review ${i}`, rating: 3, productCategory: 'Other' }));
  assert.equal((await post('/analyze/batch', { reviews: big })).status, 400);
});

test('batch validates each entry independently and preserves ref association', async () => {
  const res = await post('/analyze/batch', {
    reviews: [
      { ref: 'alpha', text: 'Great product, works perfectly.', rating: 5, productName: 'Widget', productCategory: 'Electronics' },
      { ref: 'beta', text: '', rating: 4, productCategory: 'Other' },              // invalid: empty text
      { ref: 'gamma', text: 'Fine item overall.', rating: 9, productCategory: 'Other' }, // invalid: rating
      { ref: 'delta', text: 'Nice lotion, absorbs quickly.', rating: 4 }            // invalid: missing category
    ]
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.summary.submitted, 4);
  assert.equal(body.summary.invalid, 3);
  const byRef = Object.fromEntries(body.results.map((r) => [r.ref, r]));
  assert.equal(byRef.alpha.status, 'completed');
  assert.equal(byRef.beta.status, 'invalid');
  assert.match(byRef.beta.errors.join(' '), /text:/);
  assert.equal(byRef.gamma.status, 'invalid');
  assert.match(byRef.gamma.errors.join(' '), /rating:/);
  assert.equal(byRef.delta.status, 'invalid');
  assert.match(byRef.delta.errors.join(' '), /productCategory:/);
  assert.deepEqual(body.results.map((r) => r.ref), ['alpha', 'beta', 'gamma', 'delta'], 'original entry order preserved');
});

test('batch entries keep independent ratings, metadata, and correct probability mapping', async () => {
  const res = await post('/analyze/batch', {
    reviews: [
      { ref: 'r1', text: 'Terrible, broke after one day and support ignored me.', rating: 1, productName: 'Kettle', productCategory: 'Home and Kitchen' },
      { ref: 'r2', text: 'Lovely item, works exactly as described.', rating: 5, productName: 'Serum', productCategory: 'Face Creams and Serums' }
    ]
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const byRef = Object.fromEntries(body.results.map((r) => [r.ref, r]));
  assert.equal(byRef.r1.analysis.rating, 1, 'entry 1 keeps ITS OWN rating');
  assert.equal(byRef.r2.analysis.rating, 5, 'entry 2 keeps ITS OWN rating');
  assert.equal(byRef.r1.analysis.productName, 'Kettle');
  assert.equal(byRef.r2.analysis.productCategory, 'Face Creams and Serums');
  // real model outputs mapped faithfully
  assert.equal(byRef.r1.analysis.prediction, 'fake');
  assert.equal(byRef.r2.analysis.prediction, 'genuine');
  assert.equal(byRef.r1.analysis.probabilities.fake, 0.91);
  assert.equal(byRef.r1.analysis.probabilities.genuine, 0.09);
  // binary classifier: no suspicious key is ever produced or fabricated
  assert.equal(byRef.r1.analysis.probabilities.suspicious, undefined);
  assert.equal(typeof byRef.r1.analysis.probabilities.fake, 'number');
  assert.equal(typeof byRef.r1.analysis.probabilities.genuine, 'number');
  // per-entry evidence belongs to ITS OWN review and is forwarded intact
  assert.equal(byRef.r1.analysis.evidence.reviewText, byRef.r1.analysis.text);
  assert.equal(byRef.r2.analysis.evidence.reviewText, byRef.r2.analysis.text);
  assert.notEqual(byRef.r1.analysis.evidence.reviewText, byRef.r2.analysis.evidence.reviewText);
  assert.equal(typeof byRef.r1.analysis.evidence.explanationSummary, 'string');
  assert.equal(byRef.r1.analysis.evidence.measuredSignals.length >= 1, true);
  // summary counts only actually returned predictions
  assert.equal(body.summary.predicted, 2);
  assert.equal(body.summary.fake, 1);
  assert.equal(body.summary.genuine, 1);
  assert.equal(body.summary.failed, 0);
  assert.match(body.summary.note, /model outputs/i);
});

test('batch history records store full metadata and are not duplicated', async () => {
  const before = (await (await fetch(`${base}/history`)).json()).length;
  await post('/analyze/batch', {
    reviews: [
      { ref: 'h1', text: 'Solid headphones, battery lasts forever.', rating: 4, productName: 'XM5', productCategory: 'Electronics' },
      { ref: 'h2', text: 'Garbage, it broke instantly, total trash!!', rating: 1, productCategory: 'Toys and Games' }
    ]
  });
  const after = await (await fetch(`${base}/history`)).json();
  assert.equal(after.length, before + 2, 'exactly one record per entry — no duplicates');
  const last2 = after.slice(-2);
  assert.equal(last2[0].productName, 'XM5');
  assert.equal(last2[0].productCategory, 'Electronics');
  assert.equal(last2[0].entryRef, 'h1');
  assert.equal(last2[1].productCategory, 'Toys and Games');
  assert.equal(typeof last2[1].batchId, 'string');
  assert.equal(last2[0].batchId, last2[1].batchId, 'same batch groups the pair');
  assert.notEqual(last2[0].entryRef, last2[1].entryRef, 'distinct refs distinguish entries');
  assert.equal(last2[1].prediction, 'fake', 'metadata did not alter the model verdict');
  assert.equal(typeof last2[0].evidence, 'object', 'evidence persisted with the history record');
  assert.equal(last2[0].evidence.reviewText, 'Solid headphones, battery lasts forever.');
  assert.equal(last2[1].evidence.reviewText, 'Garbage, it broke instantly, total trash!!');
});

test('partial failure keeps successful results and records only real predictions', async () => {
  const before = (await (await fetch(`${base}/history`)).json()).length;
  const res = await post('/analyze/batch', {
    reviews: [
      { ref: 'ok1', text: 'Lovely lamp, bright and warm.', rating: 5, productCategory: 'Home and Kitchen' },
      { ref: 'boom', text: 'SIMULATE_SERVICE_ERROR review text', rating: 3, productCategory: 'Other' },
      { ref: 'ok2', text: 'Terrible stand, it broke immediately.', rating: 1, productCategory: 'Electronics' }
    ]
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const byRef = Object.fromEntries(body.results.map((r) => [r.ref, r]));
  assert.equal(byRef.ok1.status, 'completed', 'successful entry survives a sibling failure');
  assert.equal(byRef.ok2.status, 'completed');
  assert.equal(byRef.boom.status, 'failed');
  assert.equal(byRef.boom.error.code, 'ML_SERVICE_ERROR');
  assert.equal(body.summary.completed, 2);
  assert.equal(body.summary.failed, 1);
  assert.equal(body.summary.predicted, 2);
  const after = (await (await fetch(`${base}/history`)).json()).length;
  assert.equal(after, before + 2, 'only the two REAL predictions were recorded');
});

test('history filters by category and verdict (Uncategorized fallback)', async () => {
  // seed a legacy record WITHOUT metadata directly in the store file
  const legacy = JSON.parse(fs.readFileSync(TEST_HISTORY, 'utf8'));
  legacy.push({ id: 'legacy1', text: 'old record', rating: 3, prediction: 'genuine', probabilities: null, trustScore: 80, analyzedAt: '2026-01-01T00:00:00.000Z' });
  fs.writeFileSync(TEST_HISTORY, JSON.stringify(legacy, null, 2));

  const elec = await (await fetch(`${base}/history?category=Electronics`)).json();
  assert.equal(elec.length >= 1, true);
  assert.equal(elec.every((r) => r.productCategory === 'Electronics'), true);

  const uncat = await (await fetch(`${base}/history?category=Uncategorized`)).json();
  assert.equal(uncat.some((r) => r.id === 'legacy1'), true, 'records without metadata surface as Uncategorized');

  const fakes = await (await fetch(`${base}/history?verdict=fake`)).json();
  assert.equal(fakes.every((r) => r.prediction === 'fake'), true);

  const bad = await fetch(`${base}/history?verdict=banana`);
  assert.equal(bad.status, 400);
});

test('stats include a real category distribution with honest fallback', async () => {
  const stats = await (await fetch(`${base}/stats`)).json();
  assert.equal(typeof stats.categoryDistribution, 'object');
  const total = Object.values(stats.categoryDistribution).reduce((a, b) => a + b, 0);
  assert.equal(total, stats.totalReviews, 'category counts sum to total reviews — no invented buckets');
});

test('single /analyze accepts optional metadata and validates category limits', async () => {
  const ok = await post('/analyze', { text: 'Very good mouse, comfy grip.', rating: 4, productName: 'G502', productCategory: 'Electronics' });
  assert.equal(ok.status, 200);
  const okBody = await ok.json();
  assert.equal(okBody.productCategory, 'Electronics');

  const badCat = await post('/analyze', { text: 'ok review', rating: 3, productCategory: 'x'.repeat(100) });
  assert.equal(badCat.status, 400);
});
