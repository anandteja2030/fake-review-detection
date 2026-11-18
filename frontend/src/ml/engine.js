/**
 * In-browser inference engine — the SAME trained stack that runs in the Python
 * service, executed locally so the app works as a static site with no server.
 *
 *   clean_text -> word TF-IDF / char_wb TF-IDF / SBERT / 9 manual features /
 *   reference similarity -> LR (sparse) + XGBoost + LightGBM (dense) -> meta LR
 *   -> threshold rule -> explainable response
 *
 * Weights come from ml/models via frontend/public/model-data (see
 * scripts/export-browser-model.py). Nothing is re-fitted, sampled or faked.
 */
import { buildVectorizer, transform, sparseDot } from './tfidf.js';
import { predictXgb, predictLgb, denseVector, logisticProbability } from './trees.js';
import { createVader } from './vader.js';
import { buildEvidence, PROMO_KEYWORDS } from './evidence.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
const DATA_URL = `${BASE.replace(/\/$/, '')}/model-data`;
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

/* ------------------------------------------------------------------ *
 * Artifact loading (once)
 * ------------------------------------------------------------------ */
let bundlePromise = null;

function decodeFloat64(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Float64Array(bytes.buffer);
}

async function getJSON(name) {
  const res = await fetch(`${DATA_URL}/${name}`);
  if (!res.ok) throw new Error(`Model artifact ${name} could not be loaded (HTTP ${res.status}).`);
  return res.json();
}

async function loadBundle() {
  const [manifest, word, char, lr, xgb, lgb, vaderLex, refBuf] = await Promise.all([
    getJSON('manifest.json'),
    getJSON('word.json'),
    getJSON('char.json'),
    getJSON('lr.json'),
    getJSON('xgb.json'),
    getJSON('lgb.json'),
    getJSON('vader.json'),
    fetch(`${DATA_URL}/ref.bin`).then((r) => {
      if (!r.ok) throw new Error('Model artifact ref.bin could not be loaded.');
      return r.arrayBuffer();
    })
  ]);

  return {
    manifest,
    word: buildVectorizer(word),
    char: buildVectorizer(char),
    lr: { coef: decodeFloat64(lr.coef), intercept: lr.intercept },
    xgb,
    lgb,
    vader: createVader(vaderLex),
    ref: new Float64Array(refBuf),
    refNorms: referenceNorms(new Float64Array(refBuf), manifest.referenceCount, manifest.sbertDim),
    scaler: {
      mean: decodeFloat64(manifest.scaler.mean),
      scale: decodeFloat64(manifest.scaler.scale)
    },
    meta: { coef: decodeFloat64(manifest.meta.coef), intercept: manifest.meta.intercept },
    threshold: manifest.threshold,
    columns: manifest.manualColumns,
    refCount: manifest.referenceCount,
    sbertDim: manifest.sbertDim
  };
}

export function loadEngine() {
  if (!bundlePromise) bundlePromise = loadBundle();
  return bundlePromise;
}

/* ------------------------------------------------------------------ *
 * Sentence-BERT (all-MiniLM-L6-v2) via transformers.js
 * ------------------------------------------------------------------ */
let embedderPromise = null;

async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const mod = await import('@huggingface/transformers');
      const { pipeline, env } = mod;
      if (env) {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
      }
      return pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' });
    })();
  }
  return embedderPromise;
}

const embeddingCache = new Map();

async function embed(cleaned) {
  if (embeddingCache.has(cleaned)) return embeddingCache.get(cleaned);
  const pipe = await getEmbedder();
  const out = await pipe(cleaned, { pooling: 'mean', normalize: true });
  const vec = Float32Array.from(out.data);
  if (embeddingCache.size > 200) embeddingCache.clear();
  embeddingCache.set(cleaned, vec);
  return vec;
}

/* ------------------------------------------------------------------ *
 * Feature pipeline (port of ml/features.py)
 * ------------------------------------------------------------------ */
const PY_CLEAN = [
  [/http\S+|www\.\S+/g, ' '],
  [/<.*?>/g, ' '],
  [/[^a-zA-Z0-9\s!?']/g, ' '],
  [/\s+/g, ' ']
];

export function cleanText(text) {
  let out = String(text);
  for (const [re, rep] of PY_CLEAN) out = out.replace(re, rep);
  return out.trim().toLowerCase();
}

function manualFeatures(rawText, rating, cleaned, simScore) {
  const words = cleaned.split(/\s+/).filter(Boolean);
  const total = words.length;
  const unique = new Set(words).size;
  const sentiment = bundle_vader().polarityScores(cleaned).compound;
  return {
    review_length: total,
    char_length: [...String(rawText)].length,
    repetition_ratio: total ? (total - unique) / total : 0,
    sentiment,
    promo_score: PROMO_KEYWORDS.filter((k) => cleaned.includes(k)).length,
    rating_sent_gap: Math.abs(Number(rating) - ((sentiment + 1) * 2.5)),
    avg_word_length: total ? words.reduce((s, w) => s + w.length, 0) / total : 0,
    short_flag: total < 5 ? 1 : 0,
    sim_score: simScore
  };
}

// Set for the duration of one prediction so manualFeatures() can reach VADER.
let activeBundle = null;
function bundle_vader() { return activeBundle.vader; }

/** Row norms of the stored reference embeddings (cosine, not raw dot). */
function referenceNorms(ref, refCount, dim) {
  const norms = new Float64Array(refCount);
  for (let r = 0; r < refCount; r += 1) {
    let sum = 0;
    const off = r * dim;
    for (let i = 0; i < dim; i += 1) sum += ref[off + i] * ref[off + i];
    norms[r] = Math.sqrt(sum);
  }
  return norms;
}

/**
 * sklearn cosine_similarity(embedding, reference_embeddings).max() — the
 * original semantic_similarity formula. Both sides are normalised SBERT
 * vectors, but the trained reference rows are float32 and therefore not
 * exactly unit norm, so the division is required to match Python.
 */
function similarity(embedding, ref, refCount, dim, norms) {
  let embNorm = 0;
  for (let i = 0; i < dim; i += 1) embNorm += embedding[i] * embedding[i];
  embNorm = Math.sqrt(embNorm);
  let best = -Infinity;
  for (let r = 0; r < refCount; r += 1) {
    let dot = 0;
    const off = r * dim;
    for (let i = 0; i < dim; i += 1) dot += embedding[i] * ref[off + i];
    const cos = dot / (embNorm * norms[r]);
    if (cos > best) best = cos;
  }
  return best;
}

function scaledManual(bundle, featureValues) {
  const out = new Float64Array(bundle.columns.length);
  bundle.columns.forEach((col, i) => {
    const v = featureValues[col];
    out[i] = (v - bundle.scaler.mean[i]) / bundle.scaler.scale[i];
  });
  return out;
}

function sparseVector(bundle, wordVec, charVec, sbert, manualScaled) {
  const wordDim = bundle.manifest.wordFeatures;
  const charDim = bundle.manifest.charFeatures;
  const out = new Map();
  for (const [i, v] of wordVec) out.set(i, v);
  for (const [i, v] of charVec) out.set(wordDim + i, v);
  for (let i = 0; i < sbert.length; i += 1) out.set(wordDim + charDim + i, sbert[i]);
  const manualOffset = wordDim + charDim + sbert.length;
  for (let i = 0; i < manualScaled.length; i += 1) out.set(manualOffset + i, manualScaled[i]);
  return out;
}

/** One full pass of the ORIGINAL pipeline for a given text/rating. */
async function featurizeAndScore(bundle, text, rating) {
  activeBundle = bundle;
  const cleaned = cleanText(text);
  const wordVec = transform(bundle.word, cleaned);
  const charVec = transform(bundle.char, cleaned);
  const sbert = await embed(cleaned);
  const simScore = similarity(sbert, bundle.ref, bundle.refCount, bundle.sbertDim, bundle.refNorms);
  const featureValues = manualFeatures(text, rating, cleaned, simScore);
  const manualScaled = scaledManual(bundle, featureValues);

  const Xsparse = sparseVector(bundle, wordVec, charVec, sbert, manualScaled);
  const zLr = sparseDot(Xsparse, bundle.lr.coef, bundle.lr.intercept);
  const pLr = 1 / (1 + Math.exp(-zLr));

  const Xdense = denseVector(sbert, manualScaled);
  const pXgb = predictXgb(bundle.xgb, Xdense);
  const pLgb = predictLgb(bundle.lgb, Xdense);

  const pFake = logisticProbability(bundle.meta.coef, bundle.meta.intercept, [pLr, pXgb, pLgb]);
  const label = pFake >= bundle.threshold ? 'fake' : 'genuine';
  return {
    cleaned,
    sbert,
    simScore,
    featureValues,
    pLr,
    pXgb,
    pLgb,
    pFake,
    label,
    confidence: label === 'fake' ? pFake : 1 - pFake,
    trustScore: Math.round((1 - pFake) * 100),
    riskLevel: label === 'fake' ? 'high' : 'low'
  };
}

/**
 * Predict one review and build its evidence, matching the Python
 * /predict contract (label, probabilities, confidence, trustScore,
 * riskLevel, modelId, modelVersion, evidence).
 */
export async function analyze(text, rating) {
  const bundle = await loadEngine();
  const core = await featurizeAndScore(bundle, text, Number(rating));

  const evidence = await buildEvidence({
    text,
    rating: Number(rating),
    cleaned: core.cleaned,
    featureValues: core.featureValues,
    simScore: core.simScore,
    pred: { pLr: core.pLr, pXgb: core.pXgb, pLgb: core.pLgb, pFake: core.pFake },
    label: core.label,
    threshold: bundle.threshold,
    refCount: bundle.refCount,
    rerunP: async (ablatedText) => (await featurizeAndScore(bundle, ablatedText, Number(rating))).pFake
  });

  return {
    prediction: core.label,
    probabilities: { fake: core.pFake, genuine: 1 - core.pFake },
    confidence: core.confidence,
    trustScore: core.trustScore,
    riskLevel: core.riskLevel,
    modelId: bundle.manifest.modelId,
    modelVersion: bundle.manifest.modelVersion,
    evidence
  };
}

/** Raw pipeline probabilities, used by the parity test. */
export async function debugScores(text, rating, sbertOverride = null) {
  const bundle = await loadEngine();
  activeBundle = bundle;
  const cleaned = cleanText(text);
  const wordVec = transform(bundle.word, cleaned);
  const charVec = transform(bundle.char, cleaned);
  const sbert = sbertOverride ? Float32Array.from(sbertOverride) : await embed(cleaned);
  const simScore = similarity(sbert, bundle.ref, bundle.refCount, bundle.sbertDim, bundle.refNorms);
  const featureValues = manualFeatures(text, Number(rating), cleaned, simScore);
  const manualScaled = scaledManual(bundle, featureValues);
  const Xsparse = sparseVector(bundle, wordVec, charVec, sbert, manualScaled);
  const pLr = 1 / (1 + Math.exp(-sparseDot(Xsparse, bundle.lr.coef, bundle.lr.intercept)));
  const Xdense = denseVector(sbert, manualScaled);
  const pXgb = predictXgb(bundle.xgb, Xdense);
  const pLgb = predictLgb(bundle.lgb, Xdense);
  const pFake = logisticProbability(bundle.meta.coef, bundle.meta.intercept, [pLr, pXgb, pLgb]);
  return { cleaned, simScore, featureValues, pLr, pXgb, pLgb, pFake, threshold: bundle.threshold };
}

export function engineInfo() {
  return { embeddingModel: EMBEDDING_MODEL, model: 'frd-stack-v1' };
}
