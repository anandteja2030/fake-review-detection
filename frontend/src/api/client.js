const BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, options = {}) {
  const { timeoutMs, ...rest } = options;
  let signal = rest.signal;
  if (timeoutMs && !signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    signal = AbortSignal.timeout(timeoutMs);
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...rest,
      signal
    });
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

export const api = {
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
