// Where every request goes.
//
// Local development and the single-service Express deploy use the same-origin
// '/api' (Vite dev proxy in development, Express static hosting in production).
// A static host such as GitHub Pages has NO backend, so a Pages build must be
// given an absolute backend URL at build time through the GitHub Actions
// repository variable VITE_API_BASE (baked in by
// .github/workflows/deploy-pages.yml, which now refuses to build without it).
import { localApi } from './local.js';

const RAW_BASE = (import.meta.env.VITE_API_BASE || '').trim();
const MODE_RAW = (import.meta.env.VITE_INFERENCE_MODE || '').trim().toLowerCase();

/**
 * Accepts `https://host`, `https://host/api` and `https://host/api/` and
 * returns one canonical form ending in `/api`, so a pasted Render URL works
 * with or without the path. An empty value stays the relative default used by
 * local development and by Express serving the built SPA itself.
 */
export function normalizeApiBase(raw) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '/api';
  return /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`;
}

export const API_BASE = normalizeApiBase(RAW_BASE);

// Hosts that only ever serve static files. A relative API base on one of these
// can only produce 404 (GET) or 405 (POST) — the exact failure this project
// shipped once, with a confusing "Request failed" message.
const STATIC_HOSTS = /(^|\.)(github\.io|githubusercontent\.com|pages\.dev|netlify\.app|vercel\.app|surge\.sh)$/i;

/**
 * Reports the configuration problem instead of sending the request to a host
 * that cannot answer it. Nothing is hidden or faked: no request is made, no
 * response is invented, and the error names the variable to set.
 */
function assertApiBaseConfigured() {
  if (!API_BASE.startsWith('/')) return;                    // absolute backend URL
  if (typeof window === 'undefined') return;                // non-browser (tests, SSR)
  if (INFERENCE_MODE === 'local') return;                   // no HTTP at all
  if (!STATIC_HOSTS.test(window.location.hostname)) return; // Express serves /api itself
  const err = new Error(
    'No backend is configured for this build: VITE_API_BASE was empty when the site was built, '
    + `so requests went to ${window.location.origin}${API_BASE} — a static file host, not the Express API. `
    + 'Set the GitHub Actions repository variable VITE_API_BASE to https://<your-api-host>/api, then re-run '
    + 'the "Deploy frontend to GitHub Pages" workflow (the value is baked in at build time).'
  );
  err.code = 'API_BASE_NOT_CONFIGURED';
  throw err;
}

async function request(path, options = {}) {
  assertApiBaseConfigured();
  const { timeoutMs, ...rest } = options;
  let signal = rest.signal;
  if (timeoutMs && !signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    signal = AbortSignal.timeout(timeoutMs);
  }
  // Only a body needs a JSON content type: sending it on GET/DELETE would turn
  // every read into a CORS preflight for no benefit.
  const headers = {
    ...(rest.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(rest.headers || {})
  };
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...rest, headers, signal });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      const err = new Error(`Request timed out after ${Math.round((timeoutMs || 0) / 1000)}s`);
      err.code = 'TIMEOUT';
      throw err;
    }
    throw e;
  }
  if (res.status === 204) return null;
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const err = new Error(body?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = body?.error;
    err.body = body;
    throw err;
  }
  return body;
}

const remoteApi = {
  health: () => request('/health'),
  modelStatus: () => request('/model/status'),
  samples: () => request('/samples'),
  categories: () => request('/categories'),
  analyze: (text, rating, meta = {}) => request('/analyze', {
    method: 'POST',
    body: JSON.stringify({ text, rating, ...meta })
  }),
  analyzeBatch: (reviews, opts = {}) => request('/analyze/batch', {
    method: 'POST',
    body: JSON.stringify({ reviews }),
    // Bounded per-chunk timeout so a hung inference call cannot stall the workflow.
    // Long enough to cover a cold model start (~75s+) while the API waits for the engine.
    timeoutMs: opts.timeoutMs ?? 240000
  }),
  history: (filters = {}) => {
    const qs = new URLSearchParams();
    if (filters.category) qs.set('category', filters.category);
    if (filters.verdict) qs.set('verdict', filters.verdict);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request(`/history${suffix}`);
  },
  clearHistory: () => request('/history', { method: 'DELETE' }),
  stats: () => request('/stats'),
  metricsLatest: () => request('/metrics/latest'),
  modelReport: () => request('/metrics/model-report')
};

/**
 * Which inference backend this build uses:
 *   'local'  — the trained models run in this browser (static hosting such as
 *              GitHub Pages; needs no server and never sleeps).
 *   'server' — the Express API is contacted over HTTP (/api or VITE_API_BASE).
 *
 * VITE_INFERENCE_MODE wins when set. Otherwise an absolute API base means a
 * real backend exists, and a static host with no API base must use local
 * inference — the alternative is requests to a file server (404/405).
 */
export const INFERENCE_MODE = (() => {
  if (MODE_RAW === 'local' || MODE_RAW === 'server') return MODE_RAW;
  if (RAW_BASE) return 'server';                 // an explicit backend wins
  if (import.meta.env.DEV) return 'server';      // dev proxy -> Express (/api)
  // A production build with no API address is a static deployment: the only
  // inference that can work there is the one shipped in the bundle.
  return 'local';
})();

export const api = INFERENCE_MODE === 'local' ? localApi : remoteApi;
