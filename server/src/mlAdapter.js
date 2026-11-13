/**
 * ML adapter layer — the single integration point for the real prediction pipeline.
 * The existing Python ML project (word/char TF-IDF + Sentence-BERT + LR/XGBoost/LightGBM
 * stacking ensemble) is NOT yet connected. No fake or random predictions are produced.
 */
import { computeFeatures, ratingSentimentGap } from './services/analysisService.js';
import { ensureModelService, isConnectionRefused, isRemoteUrl } from './mlSupervisor.js';

export const REQUIRED_MODEL_INFO = {
  provider: 'python',                        // external Python inference service (not part of this app)
  classes: ['fake', 'genuine'],
  requires: ['classifyReview(text, rating) -> { label, probabilities{fake,genuine}, confidence }']
};

/* Boot-time snapshots kept for existing imports; runtime decisions use
   mlConfig(), which re-reads the environment on every call. */
export const ADAPTER_MODE = process.env.ML_ADAPTER_MODE || 'none'; // 'none' | 'python-http'
export const ML_SERVICE_URL = process.env.ML_SERVICE_URL || null;  // e.g. http://127.0.0.1:8501/predict

const DEFAULTS = { timeoutMs: 60000, maxRetries: 2, retryBaseMs: 1000, retryCapMs: 15000, localBootWaitMs: 240000 };
const LIMITS = { timeoutMs: [1000, 300000], maxRetries: [0, 5], retryBaseMs: [100, 15000], localBootWaitMs: [0, 600000] };

function intFromEnv(name, fallback, [lo, hi]) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * Effective ML transport configuration.
 *
 * ML_REQUEST_TIMEOUT_MS — per-attempt budget. The default 60s is sized for a
 *   hosted cold start (Sentence-BERT + the whole stack load; 75s+ measured
 *   locally on a cold page cache), not for a warm request (0.3-1s).
 * ML_MAX_RETRIES      — bounded 0-5; total attempts = retries + 1.
 * ML_RETRY_BASE_MS    — exponential backoff base (doubles per attempt, capped).
 * ML_LOCAL_BOOT_WAIT_MS — only used when the engine is local and this app owns it.
 */
/**
 * Completes a bare service host with the documented POST /predict path.
 * Pasting `https://frd-ml.onrender.com` (no path) would POST to `/` and get
 * FastAPI's 404, surfacing as a confusing 502 ML_SERVICE_ERROR. An explicit
 * path is preserved exactly, so a proxy or gateway prefix still works.
 */
export function normalizeMlUrl(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const value = String(raw).trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    return value; // unparseable is reported as-is by the transport
  }
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/predict';
  else if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

export function mlConfig() {
  const mode = process.env.ML_ADAPTER_MODE || 'none';
  const url = normalizeMlUrl(process.env.ML_SERVICE_URL);
  return {
    mode,
    url,
    remote: url ? isRemoteUrl(url) : false,
    timeoutMs: intFromEnv('ML_REQUEST_TIMEOUT_MS', DEFAULTS.timeoutMs, LIMITS.timeoutMs),
    maxRetries: intFromEnv('ML_MAX_RETRIES', DEFAULTS.maxRetries, LIMITS.maxRetries),
    retryBaseMs: intFromEnv('ML_RETRY_BASE_MS', DEFAULTS.retryBaseMs, LIMITS.retryBaseMs),
    retryCapMs: DEFAULTS.retryCapMs,
    localBootWaitMs: intFromEnv('ML_LOCAL_BOOT_WAIT_MS', DEFAULTS.localBootWaitMs, LIMITS.localBootWaitMs)
  };
}

export function modelStatus() {
  const cfg = mlConfig();
  const connected = cfg.mode === 'python-http' && Boolean(cfg.url);
  return {
    connected,
    adapterMode: cfg.mode,
    serviceUrl: cfg.url,
    integration: 'python-http',
    transport: cfg.url ? (cfg.remote ? 'remote-http' : 'local-http') : null,
    timeoutMs: cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
    expectedModelInfo: REQUIRED_MODEL_INFO
  };
}

/* ------------------------------------------------------------------ *
 * Transport: bounded retries with exponential backoff
 * ------------------------------------------------------------------ */
// Transient upstream states only: overloaded (429) and gateway/boot states.
// A 500 is a deterministic model error, so re-running inference would just
// waste a cold-start budget without ever succeeding.
const RETRYABLE_HTTP = new Set([429, 502, 503, 504]);
// Transport failures worth another attempt: the peer is not answering yet.
const TRANSIENT_TRANSPORT = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'EHOSTUNREACH',
  'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'
]);

export function serviceFailure(status, code, message, extra = {}) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  Object.assign(e, extra);
  return e;
}

export function retryDelayMs(cfg, tryIndex) {
  const base = cfg.retryBaseMs ?? DEFAULTS.retryBaseMs;
  const cap = cfg.retryCapMs ?? DEFAULTS.retryCapMs;
  return Math.min(cap, base * 2 ** Math.max(0, tryIndex - 1));
}

function isTimeoutError(err) {
  const code = err?.cause?.code || err?.code;
  return err?.name === 'TimeoutError' || err?.name === 'AbortError' ||
    code === 'ETIMEDOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT';
}

/**
 * Map a transport failure to an honest error. Timeouts get their own new 503
 * code; unreachability keeps the documented 502 ML_SERVICE_UNREACHABLE contract
 * that the frontend already renders as an error state (docs/ML_INTEGRATION.md).
 */
export function toUnavailableError(err, cfg) {
  const code = err?.cause?.code || err?.code;
  if (isTimeoutError(err)) {
    return serviceFailure(503, 'ML_SERVICE_TIMEOUT',
      `Model inference timed out after ${cfg.timeoutMs}ms (${cfg.url}).`, { retryable: true, cause: code || err?.name });
  }
  const transient = isConnectionRefused(err) || TRANSIENT_TRANSPORT.has(code);
  return serviceFailure(502, 'ML_SERVICE_UNREACHABLE',
    `Model service unreachable at ${cfg.url}${code ? ` (${code})` : ''}: ${err?.message || 'unknown error'}`,
    { retryable: transient, cause: code });
}

/**
 * A non-2xx reply always surfaces as 502 ML_SERVICE_ERROR with the upstream
 * status attached, so existing clients see the same contract; `retryable` only
 * decides whether the transport tries again first.
 */
export function toServiceError(status) {
  return serviceFailure(502, 'ML_SERVICE_ERROR', `Model service responded ${status}`,
    { httpStatus: status, retryable: RETRYABLE_HTTP.has(status) });
}

/**
 * POST /predict with bounded retries. Each failure class is handled once and
 * in order, so a request is never processed twice: retries happen only after a
 * transport error or a retryable status, and a 200 short-circuits immediately.
 * Concurrent duplicate work is also prevented upstream by the supervisor's
 * single-flight state and by never retrying a 4xx (the request was understood).
 */
export async function postWithRetry(cfg, payload, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const ensureLocal = deps.ensureModelService || ensureModelService;
  const attempts = Math.max(1, cfg.maxRetries + 1);

  let tries = 0;
  let localStartTried = false;
  let lastErr = null;

  while (tries < attempts) {
    if (tries > 0) await sleep(retryDelayMs(cfg, tries));
    tries += 1;

    let response;
    try {
      response = await fetchImpl(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(cfg.timeoutMs)
      });
    } catch (err) {
      lastErr = toUnavailableError(err, cfg);
      // Local development only: the engine is a child process this app owns, so
      // a REFUSED connection means "it is not running — start it", then retry.
      // A reset/socket error means something IS listening and merely broke, so
      // restarting Python would not help (and would stall on a long model boot).
      // A hosted URL is never started from here (see mlSupervisor.isRemoteUrl).
      if (!cfg.remote && isConnectionRefused(err) && !localStartTried) {
        localStartTried = true;
        const ready = await ensureLocal({ waitMs: cfg.localBootWaitMs });
        if (ready) { tries -= 1; continue; }
      }
      if (!lastErr.retryable || tries >= attempts) throw lastErr;
      continue;
    }

    if (response.ok) return response;

    lastErr = toServiceError(response.status);
    if (!lastErr.retryable || tries >= attempts) throw lastErr;
  }

  throw lastErr || serviceFailure(502, 'ML_SERVICE_UNREACHABLE', 'Model service unavailable.');
}

export async function predict({ text, rating }) {
  const features = computeFeatures(text, rating);
  const gap = ratingSentimentGap(text, Number(rating));
  const featuresOnly = { features, ratingSentimentGap: gap };

  const cfg = mlConfig();

  if (cfg.mode === 'python-http' && cfg.url) {
    const response = await postWithRetry(cfg, { text: String(text), rating: Number(rating) });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw serviceFailure(502, 'ML_BAD_RESPONSE', 'Model service response was not valid JSON.');
    }
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
