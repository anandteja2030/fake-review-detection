import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRemoteUrl, serviceTarget, supervisorStatus, startSupervisor
} from '../src/mlSupervisor.js';
import {
  mlConfig, postWithRetry, retryDelayMs, predict
} from '../src/mlAdapter.js';

const REMOTE = 'https://frd-ml.onrender.com/predict';
const TEXT = 'Great product, works perfectly and arrived on time, very happy.';

const baseCfg = (over = {}) => ({
  mode: 'python-http', url: REMOTE, remote: true,
  timeoutMs: 5000, maxRetries: 2, retryBaseMs: 1, retryCapMs: 5, localBootWaitMs: 0, ...over
});
const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });
const refused = () => Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const evidence = () => ({
  version: 1,
  reviewText: TEXT,
  threshold: 0.42,
  topEvidence: [{ id: 'e1', category: 'model', label: 'Meta-model score', detail: 'stacked probability' }],
  suspiciousWords: [],
  measuredSignals: [{ key: 'review_length', label: 'Review length', value: 9, unit: 'words', description: 'word count', available: true }],
  explanationSummary: 'Model output summarised for this review.',
  limitations: ['Binary model; verdicts are not verified truth labels.'],
  attribution: { status: 'unavailable', description: 'not run', unavailableReason: 'ablation not requested' }
});

const validBody = () => ({
  label: 'fake',
  probabilities: { fake: 0.81, genuine: 0.19 },
  confidence: 0.81, trustScore: 19, riskLevel: 'high',
  modelId: 'frd-stack-v1', modelVersion: '1.0.0', evidence: evidence()
});

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

/* ---------------------------------------------------------------- locality */

test('isRemoteUrl: loopback is local, hosted hosts are remote', () => {
  for (const u of ['http://127.0.0.1:8501/predict', 'http://localhost:8501/predict', 'http://[::1]:8501/predict']) {
    assert.equal(isRemoteUrl(u), false, u);
  }
  for (const u of [REMOTE, 'http://ml-service.internal:8501/predict', 'http://10.0.0.5:8501/predict', 'not a url']) {
    assert.equal(isRemoteUrl(u), true, u);
  }
});

test('serviceTarget resolves health URL, port and locality', () => {
  const remote = serviceTarget(REMOTE);
  assert.equal(remote.remote, true);
  assert.equal(remote.host, 'frd-ml.onrender.com');
  assert.equal(remote.port, 443);
  assert.equal(remote.healthUrl, 'https://frd-ml.onrender.com/health');

  const local = serviceTarget('http://127.0.0.1:8501/predict');
  assert.equal(local.remote, false);
  assert.equal(local.port, 8501);
  assert.equal(local.healthUrl, 'http://127.0.0.1:8501/health');
});

test('supervisorStatus marks a remote engine as non-spawnable and starts no watcher', async () => {
  await withEnv({ ML_ADAPTER_MODE: 'python-http', ML_SERVICE_URL: REMOTE }, async () => {
    const s = supervisorStatus();
    assert.equal(s.remote, true);
    assert.equal(s.canSpawn, false);
    assert.equal(s.python, null);
    assert.equal(startSupervisor(), null, 'no watcher is created for a remote engine');
  });
});

test('supervisorStatus still reports a local engine as spawnable', async () => {
  await withEnv({ ML_ADAPTER_MODE: 'python-http', ML_SERVICE_URL: 'http://127.0.0.1:8501/predict' }, async () => {
    const s = supervisorStatus();
    assert.equal(s.remote, false);
    assert.equal(s.canSpawn, true);
  });
});

/* ---------------------------------------------------------------- timeouts */

test('mlConfig applies defaults and clamps out-of-range values', async () => {
  const defaults = await withEnv({
    ML_ADAPTER_MODE: undefined, ML_SERVICE_URL: undefined,
    ML_REQUEST_TIMEOUT_MS: undefined, ML_MAX_RETRIES: undefined, ML_RETRY_BASE_MS: undefined
  }, async () => mlConfig());
  assert.equal(defaults.mode, 'none');
  assert.equal(defaults.remote, false);
  assert.equal(defaults.timeoutMs, 60000);
  assert.equal(defaults.maxRetries, 2);

  const custom = await withEnv({ ML_REQUEST_TIMEOUT_MS: '45000', ML_MAX_RETRIES: '9', ML_RETRY_BASE_MS: '5' }, async () => mlConfig());
  assert.equal(custom.timeoutMs, 45000);
  assert.equal(custom.maxRetries, 5, 'retries are capped at 5');
  assert.equal(custom.retryBaseMs, 100, 'backoff base is floored at 100ms');

  const low = await withEnv({ ML_REQUEST_TIMEOUT_MS: '10', ML_MAX_RETRIES: '0' }, async () => mlConfig());
  assert.equal(low.timeoutMs, 1000, 'timeout is floored at 1s');
  assert.equal(low.maxRetries, 0, 'retries can be disabled');
});

test('a timeout reports 503 ML_SERVICE_TIMEOUT and uses the configured budget', async () => {
  let signal = null;
  await assert.rejects(
    () => postWithRetry(baseCfg({ maxRetries: 0, timeoutMs: 45000 }), {},
      {
        fetchImpl: async (_url, init) => { signal = init.signal; throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
        sleep: async () => {}
      }),
    (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.code, 'ML_SERVICE_TIMEOUT');
      assert.match(err.message, /45000ms/);
      return true;
    }
  );
  assert.ok(signal instanceof AbortSignal, 'a per-attempt abort signal is always supplied');
});

/* ----------------------------------------------------------------- retries */

test('retryDelayMs grows exponentially and is capped', () => {
  const cfg = baseCfg({ retryBaseMs: 100, retryCapMs: 350 });
  assert.deepEqual([1, 2, 3, 4].map((n) => retryDelayMs(cfg, n)), [100, 200, 350, 350]);
});

test('retries a transient 503 and then returns the successful response', async () => {
  const delays = [];
  let calls = 0;
  const responses = [fail(503), fail(503), ok({ label: 'fake' })];
  const res = await postWithRetry(baseCfg(), {}, {
    fetchImpl: async () => responses[calls++],
    sleep: async (ms) => delays.push(ms)
  });
  assert.equal(res.ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1, 2], 'backoff doubles between attempts');
});

test('gives up after the bounded retry budget, keeping the documented 502 contract', async () => {
  let calls = 0;
  await assert.rejects(
    () => postWithRetry(baseCfg({ maxRetries: 2 }), {}, {
      fetchImpl: async () => { calls += 1; return fail(503); },
      sleep: async () => {}
    }),
    (err) => {
      assert.equal(calls, 3, 'one initial attempt plus two retries, never more');
      assert.equal(err.status, 502);
      assert.equal(err.code, 'ML_SERVICE_ERROR');
      assert.equal(err.httpStatus, 503, 'the upstream status stays available to callers');
      return true;
    }
  );
});

test('does not retry a 500: a model error is deterministic, not transient', async () => {
  let calls = 0;
  await assert.rejects(
    () => postWithRetry(baseCfg(), {}, {
      fetchImpl: async () => { calls += 1; return fail(500); },
      sleep: async () => {}
    }),
    (err) => {
      assert.equal(calls, 1, 'inference is not re-run after an application error');
      assert.equal(err.code, 'ML_SERVICE_ERROR');
      return true;
    }
  );
});

test('does not retry a 4xx, because the request was understood', async () => {
  let calls = 0;
  await assert.rejects(
    () => postWithRetry(baseCfg(), {}, {
      fetchImpl: async () => { calls += 1; return fail(422); },
      sleep: async () => {}
    }),
    (err) => {
      assert.equal(calls, 1);
      assert.equal(err.status, 502);
      assert.equal(err.code, 'ML_SERVICE_ERROR');
      return true;
    }
  );
});

test('a refused connection retries and reports 502 ML_SERVICE_UNREACHABLE', async () => {
  let calls = 0;
  await assert.rejects(
    () => postWithRetry(baseCfg({ maxRetries: 1 }), {}, {
      fetchImpl: async () => { calls += 1; throw refused(); },
      sleep: async () => {}
    }),
    (err) => {
      assert.equal(calls, 2);
      assert.equal(err.status, 502);
      assert.equal(err.code, 'ML_SERVICE_UNREACHABLE');
      return true;
    }
  );
});

/* ------------------------------------------------- spawning must stay local */

test('a remote ML_SERVICE_URL never starts a local engine', async () => {
  let ensureCalls = 0;
  await assert.rejects(
    () => postWithRetry(baseCfg({ remote: true, maxRetries: 1 }), {}, {
      fetchImpl: async () => { throw refused(); },
      sleep: async () => {},
      ensureModelService: async () => { ensureCalls += 1; return true; }
    }),
    (err) => { assert.equal(err.status, 502); return true; }
  );
  assert.equal(ensureCalls, 0, 'remote service: spawning is never attempted');
});

test('a local ML_SERVICE_URL still starts the engine and retries once', async () => {
  let ensureCalls = 0;
  let calls = 0;
  const res = await postWithRetry(baseCfg({ remote: false, maxRetries: 0 }), {}, {
    fetchImpl: async () => { calls += 1; if (calls === 1) throw refused(); return ok({}); },
    sleep: async () => {},
    ensureModelService: async () => { ensureCalls += 1; return true; }
  });
  assert.equal(res.ok, true);
  assert.equal(ensureCalls, 1, 'local development still boots the engine');
  assert.equal(calls, 2);
});

/* ------------------------------------------------------- contract integrity */

test('predict still reports ML_NOT_CONNECTED when the adapter is off', async () => {
  await withEnv({ ML_ADAPTER_MODE: undefined, ML_SERVICE_URL: undefined }, async () => {
    await assert.rejects(() => predict({ text: TEXT, rating: 5 }), (err) => {
      assert.equal(err.code, 'ML_NOT_CONNECTED');
      assert.equal(err.status, 503);
      return true;
    });
  });
});

test('predict rejects probabilities that are not a valid binary pair', async () => {
  const body = { ...validBody(), probabilities: { fake: 0.7, genuine: 0.4 } };
  await withEnv({ ML_ADAPTER_MODE: 'python-http', ML_SERVICE_URL: REMOTE, ML_MAX_RETRIES: '0' }, () =>
    withFetch(async () => ok(body), async () => {
      await assert.rejects(() => predict({ text: TEXT, rating: 5 }), (err) => {
        assert.equal(err.status, 502);
        assert.equal(err.code, 'ML_BAD_RESPONSE');
        assert.match(err.message, /sum to 1/);
        return true;
      });
    }));
});

test('predict rejects a non-binary label', async () => {
  const body = { ...validBody(), label: 'suspicious' };
  await withEnv({ ML_ADAPTER_MODE: 'python-http', ML_SERVICE_URL: REMOTE, ML_MAX_RETRIES: '0' }, () =>
    withFetch(async () => ok(body), async () => {
      await assert.rejects(() => predict({ text: TEXT, rating: 5 }), (err) => {
        assert.equal(err.status, 502);
        assert.equal(err.code, 'ML_BAD_RESPONSE');
        assert.match(err.message, /non-binary/);
        return true;
      });
    }));
});

test('predict passes a valid response through with the same shape', async () => {
  await withEnv({ ML_ADAPTER_MODE: 'python-http', ML_SERVICE_URL: REMOTE, ML_MAX_RETRIES: '0' }, () =>
    withFetch(async () => ok(validBody()), async () => {
      const out = await predict({ text: TEXT, rating: 5 });
      assert.equal(out.prediction, 'fake');
      assert.deepEqual(out.probabilities, { fake: 0.81, genuine: 0.19 });
      assert.equal(out.source, 'python-http');
      assert.equal(out.evidence.reviewText, TEXT);
      assert.equal(out.model.version, '1.0.0');
    }));
});

test('a bare ML service URL is completed with the /predict contract path', async () => {
  const cfg = await withEnv({ ML_ADAPTER_MODE: 'python-http', ML_SERVICE_URL: 'https://frd-ml.onrender.com' }, async () => mlConfig());
  assert.equal(cfg.url, 'https://frd-ml.onrender.com/predict');
  assert.equal(cfg.remote, true);
});

test('an explicit ML service path is preserved', async () => {
  const cfg = await withEnv({ ML_ADAPTER_MODE: 'python-http', ML_SERVICE_URL: 'https://gateway.example.com/ml/predict/' }, async () => mlConfig());
  assert.equal(cfg.url, 'https://gateway.example.com/ml/predict');
});
