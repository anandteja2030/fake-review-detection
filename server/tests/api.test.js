import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

// Root-cause fix: isolate the suite from the deployment's REAL history file.
// Without this, "when empty" assertions break as soon as real analyses exist.
const TEST_HISTORY = path.join(os.tmpdir(), `afrd-test-history-${process.pid}.json`);
process.env.AFRD_HISTORY_FILE = TEST_HISTORY;
fs.rmSync(TEST_HISTORY, { force: true });

const app = createApp();
let base;
let server;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(() => { server?.close(); fs.rmSync(TEST_HISTORY, { force: true }); });

test('GET /health returns ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('GET /model/status reports model NOT connected', async () => {
  const res = await fetch(`${base}/model/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.connected, false);
  assert.equal(body.adapterMode, 'none');
});

test('POST /analyze returns no prediction while model is not connected', async () => {
  const res = await fetch(`${base}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Amazing product! Highly recommended. Excellent quality and best purchase ever!', rating: 5 })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'model_not_connected');
  assert.equal(body.prediction, null, 'prediction must be null (no fabricated labels)');
  assert.equal(body.probabilities, null, 'probabilities must be null');
  assert.equal(body.trustScore, null, 'trustScore must be null');
  assert.equal(body.riskLevel, null, 'riskLevel must be null');
  assert.equal(body.confidence, null, 'confidence must be null');
  assert.equal(body.evidence, null, 'no evidence object is fabricated without the model');
  assert.match(body.message, /not yet connected/i);
  // real heuristic features must still be computed
  assert.equal(body.features.promoHits >= 1, true, 'promotional phrase flags computed on real text');
  assert.equal(body.features.sentiment.label, 'positive');
  assert.equal(body.features.reviewLength.words > 0, true);
});

test('analysis is deterministic (no randomness)', async () => {
  const run = () => fetch(`${base}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Great great product!!! BEST purchase, highly recommended, buy it now!!!', rating: 5 })
  }).then(r => r.json());
  const a = await run(), b = await run();
  delete a.analyzedAt; delete a.requestTimeMs;
  delete b.analyzedAt; delete b.requestTimeMs;
  assert.deepEqual(a, b);
});

test('POST /analyze validates input', async () => {
  const missing = await fetch(`${base}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 5 })
  });
  assert.equal(missing.status, 400);
  const badRating = await fetch(`${base}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ok review', rating: 0 })
  });
  assert.equal(badRating.status, 400);
  const float = await fetch(`${base}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ok review', rating: 4.5 })
  });
  assert.equal(float.status, 400);
});

test('model report metrics are stored exactly as provided', async () => {
  const res = await fetch(`${base}/metrics/model-report`);
  assert.equal(res.status, 200);
  const m = await res.json();
  assert.equal(m.accuracy, 94.5);
  assert.equal(m.precision, 92.38);
  assert.equal(m.recall, 97.00);
  assert.equal(m.f1Score, 94.63);
  assert.equal(m.rocAuc, 98.81);
  assert.deepEqual(m.confusionMatrix, { TN: 552, FP: 48, FN: 18, TP: 582 });
  assert.equal(m.meta.provenance, 'user-provided');
});

test('no history is written while model is not connected', async () => {
  const before = await (await fetch(`${base}/history`)).json();
  await fetch(`${base}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'some review text here', rating: 3 })
  });
  const after = await (await fetch(`${base}/history`)).json();
  assert.equal(after.length, before.length);
});

test('GET /samples returns sample reviews', async () => {
  const res = await fetch(`${base}/samples`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(Array.isArray(body.samples), true);
  assert.equal(body.samples.length >= 5, true);
});

test('GET /metrics/latest returns 404 NO_HISTORY when empty', async () => {
  const res = await fetch(`${base}/metrics/latest`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'NO_HISTORY');
});

test('unknown API route returns JSON 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'NOT_FOUND');
});

test('rating-sentiment gap is computed', async () => {
  const res = await fetch(`${base}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Terrible awful product, it broke immediately and support ignored me', rating: 5 })
  });
  const body = await res.json();
  assert.equal(body.ratingSentimentGap.sentimentLabel, 'negative');
  assert.equal(body.ratingSentimentGap.aligned, false, '5-star rating with negative wording is misaligned');
});
