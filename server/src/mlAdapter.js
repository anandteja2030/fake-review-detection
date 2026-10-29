/**
 * ML adapter layer — the single integration point for the real prediction pipeline.
 * The existing Python ML project (word/char TF-IDF + Sentence-BERT + LR/XGBoost/LightGBM
 * stacking ensemble) is NOT yet connected. No fake or random predictions are produced.
 */
import { computeFeatures, ratingSentimentGap } from './services/analysisService.js';

export const REQUIRED_MODEL_INFO = {
  provider: 'python',                        // external Python inference service (not part of this app)
  classes: ['fake', 'genuine'],
  requires: ['classifyReview(text, rating) -> { label, probabilities{fake,genuine}, confidence }']
};

export const ADAPTER_MODE = process.env.ML_ADAPTER_MODE || 'none'; // 'none' | 'python-http'
export const ML_SERVICE_URL = process.env.ML_SERVICE_URL || null;  // e.g. http://127.0.0.1:8501/predict

export function modelStatus() {
  const connected = ADAPTER_MODE === 'python-http' && Boolean(ML_SERVICE_URL);
  return {
    connected,
    adapterMode: ADAPTER_MODE,
    serviceUrl: ML_SERVICE_URL,
    integration: 'python-http',
    expectedModelInfo: REQUIRED_MODEL_INFO
  };
}

export async function predict({ text, rating }) {
  const features = computeFeatures(text, rating);
  const gap = ratingSentimentGap(text, Number(rating));
  const featuresOnly = { features, ratingSentimentGap: gap };

  if (ADAPTER_MODE === 'python-http' && ML_SERVICE_URL) {
    let response;
    try {
      response = await fetch(ML_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: String(text), rating: Number(rating) }),
        signal: AbortSignal.timeout(10000)
      });
    } catch (err) {
      const e = new Error('Model service unreachable: ' + (err?.cause?.code || err?.name || 'error'));
      e.status = 502; e.code = 'ML_SERVICE_UNREACHABLE';
      throw e;
    }
    if (!response.ok) {
      const e = new Error(`Model service responded ${response.status}`);
      e.status = 502; e.code = 'ML_SERVICE_ERROR';
      throw e;
    }
    const payload = await response.json();
    const raw = payload?.probabilities || null;
    if (!raw || typeof raw.fake !== 'number' || typeof raw.genuine !== 'number') {
      const e = new Error('Model service response missing numeric probabilities{fake,genuine}');
      e.status = 502; e.code = 'ML_BAD_RESPONSE';
      throw e;
    }
    // Binary contract: exactly the two trained classes — never a third key.
    const probabilities = { fake: raw.fake, genuine: raw.genuine };
    if (Math.abs(raw.fake + raw.genuine - 1) > 1e-4) {
      const e = new Error('Model service probabilities do not sum to 1');
      e.status = 502; e.code = 'ML_BAD_RESPONSE';
      throw e;
    }
    if (payload.label !== 'fake' && payload.label !== 'genuine') {
      const e = new Error(`Model service returned non-binary label: ${JSON.stringify(payload.label)}`);
      e.status = 502; e.code = 'ML_BAD_RESPONSE';
      throw e;
    }
    // Evidence is part of the contract: a missing or malformed evidence object
    // is a visible 502, never silently converted into an empty success.
    const { errors: evidenceErrors, evidence } = validateEvidence(payload.evidence, String(text));
    if (evidenceErrors.length) {
      const e = new Error('Model service returned an invalid evidence object: ' + evidenceErrors.slice(0, 3).join('; '));
      e.status = 502; e.code = 'ML_BAD_RESPONSE';
      e.details = { evidenceErrors };
      throw e;
    }
    return {
      prediction: payload.label,
      probabilities,
      confidence: payload.confidence ?? null,
      trustScore: payload.trustScore ?? null,
      riskLevel: payload.riskLevel ?? null,
      model: { id: payload.modelId ?? null, version: payload.modelVersion ?? null },
      evidence,
      source: 'python-http',
      ...featuresOnly
    };
  }

  const err = new Error('ML model is not yet integrated. This deployment intentionally returns no prediction.');
  err.status = 503; err.code = 'ML_NOT_CONNECTED';
  err.details = featuresOnly;
  throw err;
}

const EVIDENCE_CATEGORIES = new Set(['model', 'measured', 'attribution']);
const NON_EMPTY = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Validates the /predict evidence object against the documented contract.
 * Returns { errors, evidence }; evidence is null when any rule fails so a
 * broken integration can never masquerade as a successful explanation.
 * Association guard: evidence.reviewText must equal the submitted review and
 * every suspicious word must be findable in that same review.
 */
export function validateEvidence(evidence, reviewText) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { errors: ['evidence: missing or not an object'], evidence: null };
  }
  if (evidence.reviewText !== reviewText) {
    fail('evidence.reviewText: does not match the submitted review (evidence belongs to a different review)');
  }
  if (!isNum(evidence.threshold) || evidence.threshold < 0 || evidence.threshold > 1) {
    fail('evidence.threshold: must be a number in [0,1]');
  }

  if (!Array.isArray(evidence.topEvidence) || evidence.topEvidence.length < 1) {
    fail('evidence.topEvidence: must be a non-empty array');
  } else {
    evidence.topEvidence.forEach((it, i) => {
      if (!it || typeof it !== 'object') return fail(`evidence.topEvidence[${i}]: must be an object`);
      if (!NON_EMPTY(it.id)) fail(`evidence.topEvidence[${i}].id: required non-empty string`);
      if (!EVIDENCE_CATEGORIES.has(it.category)) fail(`evidence.topEvidence[${i}].category: must be model|measured|attribution`);
      if (!NON_EMPTY(it.label)) fail(`evidence.topEvidence[${i}].label: required non-empty string`);
      if (!NON_EMPTY(it.detail)) fail(`evidence.topEvidence[${i}].detail: required non-empty string`);
    });
  }

  if (!Array.isArray(evidence.suspiciousWords)) {
    fail('evidence.suspiciousWords: must be an array (may be empty)');
  } else {
    const reviewNorm = norm(reviewText || '');
    evidence.suspiciousWords.forEach((w, i) => {
      if (!w || typeof w !== 'object') return fail(`evidence.suspiciousWords[${i}]: must be an object`);
      if (!NON_EMPTY(w.word)) fail(`evidence.suspiciousWords[${i}].word: required non-empty string`);
      else if (!reviewNorm.includes(norm(w.word))) {
        fail(`evidence.suspiciousWords[${i}].word '${w.word}': not present in the submitted review`);
      }
      if (!isNum(w.count) || w.count < 1) fail(`evidence.suspiciousWords[${i}].count: must be a number >= 1`);
      if (!NON_EMPTY(w.reason)) fail(`evidence.suspiciousWords[${i}].reason: required non-empty string`);
    });
  }

  if (!Array.isArray(evidence.measuredSignals) || evidence.measuredSignals.length < 1) {
    fail('evidence.measuredSignals: must be a non-empty array');
  } else {
    const keys = new Set();
    evidence.measuredSignals.forEach((s, i) => {
      if (!s || typeof s !== 'object') return fail(`evidence.measuredSignals[${i}]: must be an object`);
      if (!NON_EMPTY(s.key)) fail(`evidence.measuredSignals[${i}].key: required non-empty string`);
      else if (keys.has(s.key)) fail(`evidence.measuredSignals[${i}].key '${s.key}': duplicate`);
      else keys.add(s.key);
      if (!NON_EMPTY(s.label)) fail(`evidence.measuredSignals[${i}].label: required non-empty string`);
      if (!NON_EMPTY(s.description)) fail(`evidence.measuredSignals[${i}].description: required non-empty string`);
      if (typeof s.available !== 'boolean') return fail(`evidence.measuredSignals[${i}].available: must be boolean`);
      if (s.available) {
        if (s.value === null || s.value === undefined || !(isNum(s.value) || typeof s.value === 'string')) {
          fail(`evidence.measuredSignals[${i}].value: available signals require a numeric or string value`);
        }
      } else {
        if (s.value !== null) fail(`evidence.measuredSignals[${i}].value: unavailable signals must be null`);
        if (!NON_EMPTY(s.unavailableReason)) fail(`evidence.measuredSignals[${i}].unavailableReason: required when unavailable`);
      }
    });
  }

  if (!NON_EMPTY(evidence.explanationSummary)) fail('evidence.explanationSummary: required non-empty string');
  if (!Array.isArray(evidence.limitations) || evidence.limitations.length < 1 ||
      evidence.limitations.some((l) => !NON_EMPTY(l))) {
    fail('evidence.limitations: must be a non-empty array of non-empty strings');
  }

  const a = evidence.attribution;
  if (!a || typeof a !== 'object') {
    fail('evidence.attribution: required object');
  } else {
    if (!['available', 'unavailable'].includes(a.status)) fail('evidence.attribution.status: must be available|unavailable');
    if (!NON_EMPTY(a.description)) fail('evidence.attribution.description: required non-empty string');
    if (a.status === 'available') {
      if (!NON_EMPTY(a.method)) fail('evidence.attribution.method: required when status is available');
      if (!Array.isArray(a.terms) || a.terms.length < 1) {
        fail('evidence.attribution.terms: at least one term required when status is available');
      } else {
        a.terms.forEach((t, i) => {
          if (!t || typeof t !== 'object') return fail(`evidence.attribution.terms[${i}]: must be an object`);
          if (!NON_EMPTY(t.term)) fail(`evidence.attribution.terms[${i}].term: required`);
          for (const k of ['pFakeOriginal', 'pFakeWithoutTerm', 'deltaFakeProbability']) {
            if (!isNum(t[k])) fail(`evidence.attribution.terms[${i}].${k}: required number`);
          }
          if (isNum(t.pFakeOriginal) && (t.pFakeOriginal < 0 || t.pFakeOriginal > 1)) fail(`evidence.attribution.terms[${i}].pFakeOriginal: out of [0,1]`);
          if (isNum(t.pFakeWithoutTerm) && (t.pFakeWithoutTerm < 0 || t.pFakeWithoutTerm > 1)) fail(`evidence.attribution.terms[${i}].pFakeWithoutTerm: out of [0,1]`);
          if (isNum(t.deltaFakeProbability) && isNum(t.pFakeOriginal) && isNum(t.pFakeWithoutTerm) &&
              Math.abs(t.deltaFakeProbability - (t.pFakeOriginal - t.pFakeWithoutTerm)) > 1e-6) {
            fail(`evidence.attribution.terms[${i}].deltaFakeProbability: inconsistent with probabilities`);
          }
          if (!['fake', 'genuine'].includes(t.labelWithoutTerm)) fail(`evidence.attribution.terms[${i}].labelWithoutTerm: must be fake|genuine`);
          if (typeof t.wouldChangeLabel !== 'boolean') fail(`evidence.attribution.terms[${i}].wouldChangeLabel: must be boolean`);
        });
      }
    } else if (!NON_EMPTY(a.unavailableReason)) {
      fail('evidence.attribution.unavailableReason: required when status is unavailable');
    }
  }

  return { errors, evidence: errors.length ? null : evidence };
}

export function validateAnalyzeInput(body) {
  const errors = [];
  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    errors.push('text: review text is required and must be a non-empty string');
  }
  if (body.text && body.text.length > 20000) errors.push('text: exceeds 20000 character limit');
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.push('rating: integer 1-5 required');
  }
  return { errors, rating, text: typeof body.text === 'string' ? body.text : '' };
}
