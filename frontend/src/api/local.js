/**
 * Static-site API — same method names and response shapes as the Express API
 * (server/src/routes.js + services/serializeAnalysis.js), backed by the
 * in-browser inference engine instead of HTTP.
 *
 * History is stored in this browser's localStorage: a public static site has
 * no shared server-side store, so each visitor keeps their own real analyses.
 * Nothing here invents a prediction — every verdict comes from the trained
 * artifacts via src/ml/engine.js.
 */
import { analyze as runEngine, loadEngine } from '../ml/engine.js';
import { computeFeatures, ratingSentimentGap, clarifyingSignals } from '../ml/heuristics.js';

const STORE_KEY = 'afrd-history-v1';
const SEED_URL = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/model-data`;

export const PRODUCT_CATEGORIES = [
  'Electronics', 'Mobile Phones and Accessories', 'Computers and Laptops',
  'Beauty and Skincare', 'Face Creams and Serums', 'Lotions and Moisturizers',
  'Hair Care', 'Health and Personal Care', 'Clothing and Fashion',
  'Shoes and Accessories', 'Home and Kitchen', 'Furniture and Home Decor',
  'Food and Beverages', 'Books and Stationery', 'Toys and Games',
  'Sports and Fitness', 'Other'
];

export const MAX_BATCH = 10;
const MAX_RECORDS = 500;

/* ------------------------------------------------------------------ *
 * History storage (this browser only)
 * ------------------------------------------------------------------ */
function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStore(records) {
  const trimmed = records.slice(-MAX_RECORDS);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota: keep the most recent records rather than failing the analysis.
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed.slice(-100)));
  }
  return trimmed;
}

let seedPromise = null;
async function ensureSeeded() {
  const existing = readStore();
  if (existing) return existing;
  if (!seedPromise) {
    seedPromise = fetch(`${SEED_URL}/seed-history.json`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  const seed = await seedPromise;
  const current = readStore();
  if (current) return current;
  return writeStore(Array.isArray(seed) ? seed : []);
}

function history() {
  return readStore() || [];
}

/* ------------------------------------------------------------------ *
 * Input validation (mirrors mlAdapter.validateAnalyzeInput)
 * ------------------------------------------------------------------ */
function validateAnalyzeInput(body = {}) {
  const errors = [];
  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    errors.push('text: review text is required and must be a non-empty string');
  }
  if (body.text && body.text.length > 20000) errors.push('text: exceeds 20000 character limit');
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push('rating: integer 1-5 required');
  return { errors, rating, text: typeof body.text === 'string' ? body.text : '' };
}

function normalizeMeta(body = {}, { requireCategory = false } = {}) {
  const errors = [];
  let productName = null;
  let productCategory = null;
  if (body.productName !== undefined && body.productName !== null && String(body.productName).trim() !== '') {
    const name = String(body.productName).trim();
    if (name.length > 120) errors.push('productName: exceeds 120 character limit');
    else productName = name;
  }
  const rawCategory = body.productCategory !== undefined && body.productCategory !== null
    ? String(body.productCategory).trim() : '';
  if (rawCategory) {
    if (rawCategory.length > 60) errors.push('productCategory: exceeds 60 character limit');
    else productCategory = rawCategory;
  } else if (requireCategory) {
    errors.push('productCategory: required (choose a category or enter a custom one)');
  }
  return { errors, productName, productCategory };
}

function fail(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/* ------------------------------------------------------------------ *
 * Response serialization (mirrors serializeAnalysis)
 * ------------------------------------------------------------------ */
function serialize(result) {
  return {
    success: true,
    status: result.status,
    prediction: result.prediction ?? null,
    message: result.message ?? null,
    features: result.features ?? null,
    ratingSentimentGap: result.ratingSentimentGap ?? null,
    semanticSimilarity: result.semanticSimilarity ?? null,
    clarifyingSignals: result.clarifyingSignals ?? null,
    probabilities: result.probabilities ?? null,
    trustScore: result.trustScore ?? null,
    riskLevel: result.riskLevel ?? null,
    confidence: result.confidence ?? null,
    evidence: result.evidence ?? null,
    model: result.model ?? null,
    text: result.text ?? null,
    productName: result.productName ?? null,
    productCategory: result.productCategory ?? null,
    rating: result.rating ?? null,
    analyzedAt: result.analyzedAt,
    requestTimeMs: result.requestTimeMs
  };
}

function historyRecord({ text, rating, productName, productCategory, analysis, batchId, entryRef }) {
  return {
    id: 'h_' + Math.random().toString(36).slice(2, 10),
    ...(batchId ? { batchId, entryRef } : {}),
    text: text.slice(0, 200),
    rating,
    productName,
    productCategory,
    prediction: analysis.prediction,
    probabilities: analysis.probabilities,
    trustScore: analysis.trustScore,
    riskLevel: analysis.riskLevel,
    confidence: analysis.confidence,
    evidence: analysis.evidence ?? null,
    sentimentLabel: analysis.features?.sentiment?.label ?? null,
    ratingSentimentGap: analysis.ratingSentimentGap?.gap ?? null,
    modelVersion: analysis.model?.version ?? null,
    analyzedAt: analysis.analyzedAt
  };
}

/* ------------------------------------------------------------------ *
 * One analysis: engine + heuristics, same shape the API returned
 * ------------------------------------------------------------------ */
async function analyzeOne(text, rating, meta) {
  const t0 = Date.now();
  const result = await runEngine(text, rating);
  const features = computeFeatures(text, rating);
  const gap = ratingSentimentGap(text, Number(rating));
  return serialize({
    status: 'model_connected',
    prediction: result.prediction,
    probabilities: result.probabilities,
    confidence: result.confidence,
    trustScore: result.trustScore,
    riskLevel: result.riskLevel,
    evidence: result.evidence,
    model: { id: result.modelId, version: result.modelVersion },
    features,
    ratingSentimentGap: gap,
    clarifyingSignals: clarifyingSignals({ ...features, rating: Number(rating) }),
    text,
    rating: Number(rating),
    productName: meta.productName,
    productCategory: meta.productCategory,
    analyzedAt: new Date(t0).toISOString(),
    requestTimeMs: Date.now() - t0
  });
}

/* ------------------------------------------------------------------ *
 * Stats (mirrors historyStore.computeStats + statsUtils)
 * ------------------------------------------------------------------ */
const round1 = (x) => Math.round(x * 10) / 10;

function computeStats(records) {
  const total = records.length;
  const count = (label) => records.filter((h) => h.prediction === label).length;
  const scored = records.filter((h) => typeof h.trustScore === 'number');
  const avg = scored.length ? round1(scored.reduce((s, h) => s + h.trustScore, 0) / scored.length) : null;
  const ratings = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const h of records) if (ratings[h.rating] !== undefined) ratings[h.rating] += 1;
  const sentiments = {};
  for (const h of records) if (h.sentimentLabel) sentiments[h.sentimentLabel] = (sentiments[h.sentimentLabel] || 0) + 1;
  const categories = {};
  for (const h of records) {
    const c = h.productCategory || 'Uncategorized';
    categories[c] = (categories[c] || 0) + 1;
  }
  return {
    totalReviews: total,
    fake: count('fake'),
    genuine: count('genuine'),
    notPredicted: total - (count('fake') + count('genuine')),
    averageTrustScore: avg,
    ratingDistribution: ratings,
    sentimentDistribution: sentiments,
    categoryDistribution: categories
  };
}

function trustHistogram(records) {
  const buckets = [
    { label: '0-20', min: 0, max: 20, count: 0 },
    { label: '21-40', min: 21, max: 40, count: 0 },
    { label: '41-60', min: 41, max: 60, count: 0 },
    { label: '61-80', min: 61, max: 80, count: 0 },
    { label: '81-100', min: 81, max: 100, count: 0 }
  ];
  for (const h of records) {
    if (typeof h.trustScore !== 'number') continue;
    for (const b of buckets) {
      if (h.trustScore >= b.min && h.trustScore <= b.max) { b.count += 1; break; }
    }
  }
  return buckets;
}

/* ------------------------------------------------------------------ *
 * Public surface — identical method names to the HTTP client
 * ------------------------------------------------------------------ */
export const localApi = {
  async health() {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      service: 'explainable-fake-review-detection-api',
      history: { backend: 'browser-localstorage', durable: false, lastError: null }
    };
  },

  async modelStatus() {
    await loadEngine();
    return {
      connected: true,
      adapterMode: 'browser-onnx',
      serviceUrl: null,
      integration: 'browser-onnx',
      transport: 'in-browser',
      timeoutMs: 0,
      maxRetries: 0,
      expectedModelInfo: {
        provider: 'in-browser',
        classes: ['fake', 'genuine'],
        requires: ['classifyReview(text, rating) -> { label, probabilities{fake,genuine}, confidence }']
      },
      message: 'Trained stacking ensemble loaded in this browser (TF-IDF, all-MiniLM-L6-v2, LR + XGBoost + LightGBM, meta-LR). No server is used.'
    };
  },

  async samples() {
    const res = await fetch(`${SEED_URL}/samples.json`);
    if (!res.ok) return { samples: [] };
    return { samples: await res.json() };
  },

  async categories() {
    return { categories: PRODUCT_CATEGORIES, maxBatch: MAX_BATCH };
  },

  async analyze(text, rating, meta = {}) {
    const { errors, text: validText, rating: validRating } = validateAnalyzeInput({ text, rating });
    const m = normalizeMeta(meta, { requireCategory: false });
    if (errors.length || m.errors.length) {
      throw fail(400, 'INVALID_INPUT', 'Validation failed.', { body: { errors: [...errors, ...m.errors] } });
    }
    const analysis = await analyzeOne(validText, validRating, m);
    const records = await ensureSeeded();
    writeStore([...records, historyRecord({
      text: validText,
      rating: validRating,
      productName: m.productName,
      productCategory: m.productCategory,
      analysis
    })]);
    return analysis;
  },

  async analyzeBatch(reviews) {
    if (!Array.isArray(reviews) || reviews.length === 0) {
      throw fail(400, 'INVALID_BATCH', 'Batch validation failed.', { body: { errors: ['reviews: non-empty array required'] } });
    }
    if (reviews.length > MAX_BATCH) {
      throw fail(400, 'INVALID_BATCH', 'Batch validation failed.', { body: { errors: [`reviews: exceeds ${MAX_BATCH} entries`] } });
    }
    const batchId = 'b_' + Math.random().toString(36).slice(2, 12);
    const records = await ensureSeeded();
    const results = [];
    const newRecords = [];
    for (let i = 0; i < reviews.length; i += 1) {
      const raw = reviews[i] || {};
      const ref = raw.ref ?? `r${i + 1}`;
      const { errors, text, rating } = validateAnalyzeInput(raw);
      const m = normalizeMeta(raw, { requireCategory: true });
      if (errors.length || m.errors.length) {
        results.push({ ref, index: i, status: 'invalid', errors: [...errors, ...m.errors] });
        continue;
      }
      try {
        const analysis = await analyzeOne(text, rating, m);
        results.push({ ref, index: i, status: 'completed', analysis });
        newRecords.push(historyRecord({
          text, rating, productName: m.productName, productCategory: m.productCategory,
          analysis, batchId, entryRef: ref
        }));
      } catch (err) {
        results.push({ ref, index: i, status: 'failed', error: { code: err.code || 'ENGINE_ERROR', message: err.message } });
      }
    }
    if (newRecords.length) writeStore([...records, ...newRecords]);
    const completed = results.filter((r) => r.status === 'completed' && r.analysis?.prediction);
    return {
      batchId,
      summary: {
        submitted: reviews.length,
        invalid: results.filter((r) => r.status === 'invalid').length,
        completed: results.filter((r) => r.status === 'completed').length,
        predicted: completed.length,
        failed: results.filter((r) => r.status === 'failed').length,
        fake: completed.filter((r) => r.analysis.prediction === 'fake').length,
        genuine: completed.filter((r) => r.analysis.prediction === 'genuine').length,
        note: 'Fake/Genuine counts are model outputs — not independently verified truth labels.'
      },
      results
    };
  },

  async history(filters = {}) {
    const records = await ensureSeeded();
    return records.filter((h) => {
      if (filters.verdict && h.prediction !== filters.verdict) return false;
      if (filters.category) {
        const c = h.productCategory || 'Uncategorized';
        if (c !== filters.category) return false;
      }
      return true;
    });
  },

  async clearHistory() {
    writeStore([]);
    return null;
  },

  async stats() {
    const records = await ensureSeeded();
    return { ...computeStats(records), modelConnected: true };
  },

  async metricsLatest() {
    const records = await ensureSeeded();
    if (!records.length) {
      throw fail(404, 'NO_HISTORY', 'No analysis history yet. Charts populate after real model-connected analyses are recorded.');
    }
    return {
      window: {
        totalAnalyses: records.length,
        firstAnalyzedAt: records[0]?.analyzedAt ?? null,
        lastAnalyzedAt: records[records.length - 1]?.analyzedAt ?? null
      },
      trustScoreDistribution: trustHistogram(records),
      ratingDistribution: computeStats(records).ratingDistribution,
      sentimentDistribution: computeStats(records).sentimentDistribution,
      modelConnected: true
    };
  },

  async modelReport() {
    const res = await fetch(`${SEED_URL}/model-metrics.json`);
    if (!res.ok) throw fail(500, 'METRICS_UNAVAILABLE', 'Model metrics file could not be loaded.');
    const raw = await res.json();
    return {
      ...raw,
      provenance: 'user-provided',
      note: 'Values are stored and shown exactly as provided by the project author; they are not recomputed or verified by this application.'
    };
  }
};
