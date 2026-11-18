/**
 * Parity harness: the browser engine vs the Python service.
 *
 * For each fixture exported from ml/predictor.py (real trained-artifact
 * outputs), this recomputes the same review with the JS port and compares:
 *   cleaned text, VADER sentiment, all 9 manual features, reference
 *   similarity, word/char TF-IDF -> Logistic Regression, XGBoost, LightGBM,
 *   the stacking meta-model, and the threshold rule.
 *
 * The SBERT vector is injected from the fixture so embedding-runtime
 * differences (transformers.js q8 vs PyTorch fp32) are measured separately
 * instead of hiding numeric bugs in the ported code.
 *
 * Run: node scripts/verify-browser-engine.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVectorizer, transform, sparseDot } from '../frontend/src/ml/tfidf.js';
import { predictXgb, predictLgb, denseVector, logisticProbability } from '../frontend/src/ml/trees.js';
import { createVader } from '../frontend/src/ml/vader.js';
import { cleanText } from '../frontend/src/ml/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'frontend', 'public', 'model-data');
const read = (n) => JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8'));

function decodeFloat64(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
}

const manifest = read('manifest.json');
const word = buildVectorizer(read('word.json'));
const char = buildVectorizer(read('char.json'));
const lrJson = read('lr.json');
const lr = { coef: decodeFloat64(lrJson.coef), intercept: lrJson.intercept };
const xgb = read('xgb.json');
const lgb = read('lgb.json');
const vader = createVader(read('vader.json'));
const meta = { coef: decodeFloat64(manifest.meta.coef), intercept: manifest.meta.intercept };
const scaler = { mean: decodeFloat64(manifest.scaler.mean), scale: decodeFloat64(manifest.scaler.scale) };
const refBuf = fs.readFileSync(path.join(DATA, 'ref.bin'));
const ref = new Float64Array(refBuf.buffer, refBuf.byteOffset, refBuf.byteLength / 8);
const dim = manifest.sbertDim;
const fixtures = read('fixtures.json');
const PROMO = ['buy', 'shop', 'discount', 'sale', 'offer', 'limited time', 'exclusive', 'save', 'free',
  'bonus', 'deal', 'promo', 'coupon', 'bargain', 'great value', 'get yours now', 'order now', 'amazing',
  'perfect', 'best', 'excellent', 'fantastic', 'must buy', 'highly recommended'];

function manualFeatures(rawText, rating, cleaned, sim) {
  const words = cleaned.split(/\s+/).filter(Boolean);
  const total = words.length;
  const unique = new Set(words).size;
  const sentiment = vader.polarityScores(cleaned).compound;
  return {
    review_length: total,
    char_length: [...String(rawText)].length,
    repetition_ratio: total ? (total - unique) / total : 0,
    sentiment,
    promo_score: PROMO.filter((k) => cleaned.includes(k)).length,
    rating_sent_gap: Math.abs(Number(rating) - ((sentiment + 1) * 2.5)),
    avg_word_length: total ? words.reduce((s, w) => s + w.length, 0) / total : 0,
    short_flag: total < 5 ? 1 : 0,
    sim_score: sim
  };
}

const REF_NORMS = (() => {
  const norms = new Float64Array(manifest.referenceCount);
  for (let r = 0; r < manifest.referenceCount; r += 1) {
    let sum = 0;
    const off = r * dim;
    for (let i = 0; i < dim; i += 1) sum += ref[off + i] * ref[off + i];
    norms[r] = Math.sqrt(sum);
  }
  return norms;
})();

function similarity(emb) {
  let n = 0;
  for (let i = 0; i < dim; i += 1) n += emb[i] * emb[i];
  n = Math.sqrt(n);
  let best = -Infinity;
  for (let r = 0; r < manifest.referenceCount; r += 1) {
    let dot = 0;
    const off = r * dim;
    for (let i = 0; i < dim; i += 1) dot += emb[i] * ref[off + i];
    const cos = dot / (n * REF_NORMS[r]);
    if (cos > best) best = cos;
  }
  return best;
}

let failures = 0;
let agreedLabels = 0;
let checks = 0;
const worst = { pLr: 0, pXgb: 0, pLgb: 0, pFake: 0, sentiment: 0, sim: 0 };

for (const c of fixtures.cases) {
  const cleaned = cleanText(c.text);
  const wordVec = transform(word, cleaned);
  const charVec = transform(char, cleaned);
  const sbert = Float32Array.from(c.sbert);
  const sim = similarity(sbert);
  const f = manualFeatures(c.text, c.rating, cleaned, sim);

  const sparse = new Map();
  for (const [i, v] of wordVec) sparse.set(i, v);
  for (const [i, v] of charVec) sparse.set(manifest.wordFeatures + i, v);
  for (let i = 0; i < sbert.length; i += 1) sparse.set(manifest.wordFeatures + manifest.charFeatures + i, sbert[i]);
  const off = manifest.wordFeatures + manifest.charFeatures + sbert.length;
  manifest.manualColumns.forEach((col, i) => {
    sparse.set(off + i, (f[col] - scaler.mean[i]) / scaler.scale[i]);
  });

  const pLr = 1 / (1 + Math.exp(-sparseDot(sparse, lr.coef, lr.intercept)));
  const manualScaled = Float64Array.from(manifest.manualColumns.map((col, i) => (f[col] - scaler.mean[i]) / scaler.scale[i]));
  const dense = denseVector(sbert, manualScaled);
  const pXgb = predictXgb(xgb, dense);
  const pLgb = predictLgb(lgb, dense);
  const pFake = logisticProbability(meta.coef, meta.intercept, [pLr, pXgb, pLgb]);
  const label = pFake >= fixtures.threshold ? 'fake' : 'genuine';

  const rows = [
    ['cleaned', c.cleaned === cleaned ? 0 : 1],
    ['sentiment', Math.abs((c.manual.sentiment ?? 0) - f.sentiment)],
    ['sim', Math.abs(c.sim - sim)],
    ['pLr', Math.abs(c.pLr - pLr)],
    ['pXgb', Math.abs(c.pXgb - pXgb)],
    ['pLgb', Math.abs(c.pLgb - pLgb)],
    ['pFake', Math.abs(c.pFake - pFake)]
  ];
  for (const [name, delta] of rows) {
    checks += 1;
    // Tolerances reflect what is reproducible outside the training library:
    // TF-IDF/LR/LightGBM agree to ~1e-12; XGBoost evaluates in float32, and a
    // handful of trees split exactly on values that the browser computes in
    // float64, so one base learner can move by up to ~0.05 for some inputs.
    const tol = {
      cleaned: 0, sentiment: 1e-9, sim: 1e-9, pLr: 1e-9, pLgb: 1e-9,
      pXgb: 5e-2, pFake: 2e-2
    }[name];
    if (delta > tol) {
      failures += 1;
      console.log(`  MISMATCH ${name} ${delta.toExponential(2)} :: ${JSON.stringify(c.text).slice(0, 60)}`);
    }
    if (name in worst) worst[name] = Math.max(worst[name], delta);
  }
  const manualDeltas = manifest.manualColumns
    .map((col) => [col, Math.abs((c.manual[col] ?? 0) - f[col])])
    .filter(([, d]) => d > 1e-6);
  if (manualDeltas.length) {
    failures += 1;
    console.log(`  MISMATCH manual features: ${manualDeltas.map(([k, d]) => `${k}=${d.toExponential(2)}`).join(', ')}`);
  }
  if (label === c.label) agreedLabels += 1;
  if (label !== c.label) {
    failures += 1;
    console.log(`  MISMATCH label ${label} vs ${c.label}`);
  }
  checks += 1;
  console.log(`  ${label === c.label ? 'ok  ' : 'FAIL'} pFake ${pFake.toFixed(6)}/${c.pFake.toFixed(6)}  pLr ${pLr.toFixed(6)}/${c.pLr.toFixed(6)}  pXgb ${pXgb.toFixed(6)}/${c.pXgb.toFixed(6)}  pLgb ${pLgb.toFixed(6)}/${c.pLgb.toFixed(6)}  :: ${JSON.stringify(c.text).slice(0,42)}`);
}

console.log(`\nfixtures: ${fixtures.cases.length}   checks: ${checks}   failures: ${failures}`);
console.log(`largest abs deviation: pLr ${worst.pLr.toExponential(2)}, pXgb ${worst.pXgb.toExponential(2)}, pLgb ${worst.pLgb.toExponential(2)}, pFake ${worst.pFake.toExponential(2)}`);
process.exit(failures ? 1 : 0);
