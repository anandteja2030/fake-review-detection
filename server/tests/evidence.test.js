import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ---------------------------------------------------------------------------
// Evidence contract suite: exercises the schema validation and error mapping
// between the documented Python /predict contract and the Express API.
// A local mock stands in for the transport only; the real deployment talks to
// the trained FastAPI service (verified separately in E2E).
// Env must be set BEFORE importing app.js (adapter reads it at module load).
// ---------------------------------------------------------------------------
process.env.ML_ADAPTER_MODE = 'python-http';

/** Build a contract-valid evidence object for an arbitrary review text. */
function makeEvidence(text, { label = 'genuine', pFake = 0.06, signalAvailable = true, word } = {}) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const suspicious = word
    ? [{ word, count: 2, reason: "promotional keyword from the model's PROMO_KEYWORDS list - presence counts once toward the promo_score input feature" }]
    : [];
  return {
    version: 1,
    reviewText: text,
    threshold: 0.4738,
    topEvidence: [
      { id: 'decision', category: 'model',
        label: `Stacking ensemble verdict: ${label.toUpperCase()}`,
        detail: `P(fake) = ${pFake.toFixed(4)} vs decision threshold 0.4738 -> ${label.toUpperCase()}.` },
      { id: 'promo-language', category: 'measured',
        label: `${suspicious.length} promotional term(s) matched in this review`,
        detail: 'Matches feed the promo_score input feature. Matching promotional wording is not proof of deception.' }
    ],
    suspiciousWords: suspicious,
    measuredSignals: [
      { key: 'review_length', label: 'Review length', value: words.length, unit: 'words',
        description: "Word count of the cleaned text - the model's review_length input feature.",
        available: true, unavailableReason: null },
      { key: 'sentiment', label: 'Sentiment (VADER compound)', value: signalAvailable ? 0.42 : null, unit: 'compound',
        description: 'VADER compound sentiment of the cleaned text, from -1 to +1.',
        available: signalAvailable,
        unavailableReason: signalAvailable ? null : 'The cleaned text has no lexical content, so the compound score carries no sentiment information.' },
      { key: 'promo_score', label: 'Promotional keyword score', value: suspicious.length, unit: 'keywords',
        description: "Number of PROMO_KEYWORDS matched in the cleaned text - the model's promo_score input feature.",
        available: true, unavailableReason: null }
    ],
    explanationSummary: `The model classified this ${words.length}-token review as ${label.toUpperCase()} (P(fake)=${pFake.toFixed(4)} against a decision threshold of 0.4738). Measured promotional language: ${suspicious.length} match(es) feeding promo_score.`,
    limitations: [
      'Measured signals are inputs to the model and diagnostics on the text; they do not establish why the ensemble produced its verdict.',
      'Term-ablation attribution is a perturbation sensitivity measurement on this trained model - not SHAP, not LIME, and not a causal claim.',
      'The classifier detects statistical patterns in wording; it cannot verify whether any individual review is genuinely deceptive.'
    ],
    attribution: {
      method: 'term-ablation-perturbation', status: 'available',
      description: 'Term-ablation sensitivity: each listed term is deleted from the submitted review text and the full model pipeline is re-run.',
      unavailableReason: null,
      terms: [{
        term: 'amazing', pFakeOriginal: pFake, pFakeWithoutTerm: Math.min(1, Math.max(0, pFake - 0.08)),
        deltaFakeProbability: pFake - Math.min(1, Math.max(0, pFake - 0.08)),
        labelWithoutTerm: 'genuine', wouldChangeLabel: false
      }]
    }
  };
}

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const { text = '' } = JSON.parse(body || '{}');

    if (/DESTROY_CONNECTION/i.test(text)) { req.socket.destroy(); return; }

    const base = {
      label: 'genuine',
      probabilities: { fake: 0.06, genuine: 0.94 },
      confidence: 0.94, trustScore: 94, riskLevel: 'low',
      modelId: 'frd-stack-v1', modelVersion: '1.0.0',
      evidence: makeEvidence(text, { word: /amazing/i.test(text) ? 'amazing' : undefined })
    };

    if (/EVIDENCE_MISSING/i.test(text)) delete base.evidence;
    else if (/EVIDENCE_MALFORMED/i.test(text)) base.evidence = { reviewText: text, topEvidence: [] };
    else if (/EVIDENCE_MIXED/i.test(text)) base.evidence = { ...makeEvidence(text), reviewText: 'a completely different review' };
    else if (/EVIDENCE_WRONGWORD/i.test(text)) base.evidence = { ...makeEvidence(text), suspiciousWords: [{ word: 'zebra', count: 3, reason: 'not in this review' }] };
    else if (/EVIDENCE_UNAVAILABLE_OK/i.test(text)) base.evidence = makeEvidence(text, { signalAvailable: false });
    else if (/BAD_LABEL/i.test(text)) base.label = 'suspicious';
    else if (/BAD_SUM/i.test(text)) base.probabilities = { fake: 0.7, genuine: 0.2 };

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(base));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
process.env.ML_SERVICE_URL = `http://127.0.0.1:${mock.address().port}/predict`;

const TEST_HISTORY = path.join(os.tmpdir(), `afrd-evidence-history-${process.pid}.json`);
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

test('single /analyze forwards the full evidence object for the submitted review', async () => {
  const text = 'Absolutely amazing product, amazing quality, amazing value for money!';
  const res = await post('/analyze', { text, rating: 5, productCategory: 'Electronics' });
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.status, 'model_connected');
  assert.equal(b.prediction, 'genuine');
  const ev = b.evidence;
  assert.ok(ev, 'evidence present');
  assert.equal(ev.reviewText, text, 'evidence belongs to the submitted review');
  assert.equal(typeof ev.threshold, 'number');
  assert.equal(ev.topEvidence.length >= 1, true);
  assert.equal(ev.topEvidence.every((i) => i.label && i.detail && ['model', 'measured', 'attribution'].includes(i.category)), true);
  assert.equal(ev.suspiciousWords[0].word, 'amazing');
  assert.equal(ev.suspiciousWords.some((w) => w.reason.includes('PROMO_KEYWORDS')), true);
  assert.equal(ev.measuredSignals.length >= 3, true);
  assert.equal(ev.measuredSignals.find((s) => s.key === 'review_length').value, text.split(/\s+/).length);
  assert.equal(typeof ev.explanationSummary, 'string');
  assert.equal(ev.explanationSummary.toLowerCase().includes('genuine'), true, 'summary references this review outcome');
  assert.equal(ev.limitations.length >= 1, true);
  assert.equal(ev.attribution.status, 'available');
  assert.equal(ev.attribution.terms[0].term, 'amazing');
  // probabilities remain valid and consistent
  assert.equal(Math.abs(b.probabilities.fake + b.probabilities.genuine - 1) < 1e-6, true);
});

test('unavailable signals pass validation with value=null and a reason', async () => {
  const res = await post('/analyze', { text: 'EVIDENCE_UNAVAILABLE_OK ...', rating: 3 });
  assert.equal(res.status, 200);
  const b = await res.json();
  const sent = b.evidence.measuredSignals.find((s) => s.key === 'sentiment');
  assert.equal(sent.available, false);
  assert.equal(sent.value, null);
  assert.equal(typeof sent.unavailableReason, 'string');
});

test('missing evidence is a visible 502, never an empty success', async () => {
  const res = await post('/analyze', { text: 'EVIDENCE_MISSING review text', rating: 4 });
  assert.equal(res.status, 502);
  const b = await res.json();
  assert.equal(b.error, 'ML_BAD_RESPONSE');
  assert.match(b.message, /invalid evidence/i);
});

test('malformed evidence fails validation with field-level errors', async () => {
  const res = await post('/analyze', { text: 'EVIDENCE_MALFORMED review text', rating: 4 });
  assert.equal(res.status, 502);
  const b = await res.json();
  assert.equal(b.error, 'ML_BAD_RESPONSE');
  assert.equal(Array.isArray(b.details?.evidenceErrors), true);
  assert.ok(b.details.evidenceErrors.some((e) => e.includes('topEvidence')));
});

test('evidence belonging to a DIFFERENT review is rejected (association guard)', async () => {
  const res = await post('/analyze', { text: 'EVIDENCE_MIXED review text', rating: 4 });
  assert.equal(res.status, 502);
  const b = await res.json();
  assert.equal(b.error, 'ML_BAD_RESPONSE');
  assert.match(b.message, /different review/i);
});

test('a suspicious word absent from the review is rejected', async () => {
  const res = await post('/analyze', { text: 'EVIDENCE_WRONGWORD review text', rating: 4 });
  assert.equal(res.status, 502);
  const b = await res.json();
  assert.equal(b.error, 'ML_BAD_RESPONSE');
  assert.match(b.message, /not present in the submitted review/i);
});

test('non-binary labels are rejected', async () => {
  const res = await post('/analyze', { text: 'BAD_LABEL review text', rating: 4 });
  assert.equal(res.status, 502);
  const b = await res.json();
  assert.equal(b.error, 'ML_BAD_RESPONSE');
  assert.match(b.message, /non-binary label/i);
});

test('probabilities that do not sum to 1 are rejected', async () => {
  const res = await post('/analyze', { text: 'BAD_SUM review text', rating: 4 });
  assert.equal(res.status, 502);
  const b = await res.json();
  assert.equal(b.error, 'ML_BAD_RESPONSE');
  assert.match(b.message, /sum to 1/i);
});

test('an unreachable ML service produces 502, never a fabricated success', async () => {
  const res = await post('/analyze', { text: 'DESTROY_CONNECTION review text', rating: 4 });
  assert.equal(res.status, 502);
  const b = await res.json();
  assert.equal(b.error, 'ML_SERVICE_UNREACHABLE');
  assert.equal(b.prediction, undefined);
});

test('batch: per-entry evidence association and history persistence', async () => {
  const before = (await (await fetch(`${base}/history`)).json()).length;
  const res = await post('/analyze/batch', {
    reviews: [
      { ref: 'ev1', text: 'Lovely kettle, boils fast every morning.', rating: 5, productCategory: 'Home and Kitchen' },
      { ref: 'ev2', text: 'Amazing wallet, amazing leather, amazing deal!', rating: 4, productCategory: 'Electronics' },
      { ref: 'ev3', text: 'EVIDENCE_MISSING entry, must fail honestly', rating: 3, productCategory: 'Other' }
    ]
  });
  assert.equal(res.status, 200);
  const b = await res.json();
  const byRef = Object.fromEntries(b.results.map((r) => [r.ref, r]));
  // each success carries ITS OWN evidence
  assert.equal(byRef.ev1.status, 'completed');
  assert.equal(byRef.ev1.analysis.evidence.reviewText, byRef.ev1.analysis.text);
  assert.equal(byRef.ev2.status, 'completed');
  assert.equal(byRef.ev2.analysis.evidence.reviewText, byRef.ev2.analysis.text);
  assert.notEqual(byRef.ev1.analysis.evidence.reviewText, byRef.ev2.analysis.evidence.reviewText);
  assert.equal(byRef.ev1.analysis.evidence.suspiciousWords.length, 0, 'no invented words for ev1');
  assert.equal(byRef.ev2.analysis.evidence.suspiciousWords[0].word, 'amazing');
  // the malformed sibling FAILS instead of silently producing empty evidence
  assert.equal(byRef.ev3.status, 'failed');
  assert.equal(byRef.ev3.error.code, 'ML_BAD_RESPONSE');
  assert.equal(b.summary.completed, 2);
  assert.equal(b.summary.failed, 1);
  // exactly the two real predictions recorded, evidence included
  const after = (await (await fetch(`${base}/history`)).json());
  assert.equal(after.length, before + 2);
  assert.equal(after.slice(-2)[0].evidence.reviewText, 'Lovely kettle, boils fast every morning.');
});

test('legacy history records without evidence remain readable', async () => {
  const rows = JSON.parse(fs.readFileSync(TEST_HISTORY, 'utf8'));
  rows.push({ id: 'legacy_no_evidence', text: 'old record', rating: 3, prediction: 'genuine',
              probabilities: { fake: 0.2, genuine: 0.8 }, trustScore: 80,
              analyzedAt: '2025-12-01T00:00:00.000Z' });
  fs.writeFileSync(TEST_HISTORY, JSON.stringify(rows, null, 2));
  const all = await (await fetch(`${base}/history`)).json();
  const legacy = all.find((r) => r.id === 'legacy_no_evidence');
  assert.ok(legacy, 'legacy record still served');
  assert.equal(legacy.evidence, undefined, 'no evidence key is invented for old records');
});
