/**
 * ML service supervisor.
 *
 * The Express API integrates with the Python inference service (ml/serve.py)
 * over HTTP. Nothing else in the app guarantees that service is running, so a
 * stopped/crashed engine used to surface as "ML_SERVICE_UNREACHABLE —
 * ECONNREFUSED" on the next Analyze click.
 *
 * This module owns that lifecycle:
 *   - on API boot it ensures the engine is up (starting it when needed),
 *   - a watcher restarts it if it dies,
 *   - a prediction that hits a refused connection waits for the engine to come
 *     up; the adapter then retries the request (see mlAdapter.js).
 *
 * Loading the models takes tens of seconds, so the supervisor never spawns a
 * second engine while one is still booting: that would race for the port and
 * produce a spawn storm. It waits for either health or the process to exit.
 *
 * It never fabricates predictions: if Python or its artifacts are missing the
 * failures are logged honestly and the API keeps returning real errors.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ML_DIR = path.join(ROOT, 'ml');
const LOG_FILE = path.join(ROOT, 'fastapi.log');
const ENTRY = 'serve.py';

const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8501/predict';
// Bracketed and bare IPv6 loopback are both reported by URL hostname depending
// on the runtime, so both are listed.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

/**
 * A loopback ML_SERVICE_URL means the engine runs on THIS machine — the only
 * case where this process may spawn Python. Anything else (Render, a private
 * network name, a typo) is treated as remote, so no local engine is ever
 * started for it: that would be slow, wrong, and confusing in the logs.
 */
export function isRemoteUrl(url) {
  try {
    const { hostname } = new URL(url);
    return !LOOPBACK_HOSTS.has(String(hostname).toLowerCase());
  } catch {
    return true; // unparseable → remote (never spawn on a guess)
  }
}

export function adapterEnabled() {
  return (process.env.ML_ADAPTER_MODE || 'none') === 'python-http';
}

/**
 * Who owns the Python engine's lifecycle?
 *
 * Default (env unset): this process does — right for local development, where
 * `scripts/start-all.sh` and the API share one machine.
 *
 * `ML_MANAGE_ENGINE=off`: the platform does. That is the container case: the
 * entrypoint starts uvicorn, so ML_SERVICE_URL is loopback but this process must
 * NOT spawn a second engine — it would collide on the port and take the
 * container down. The adapter still talks to the URL; it simply never starts
 * anything.
 */
export function engineManagementEnabled() {
  const value = String(process.env.ML_MANAGE_ENGINE || '').trim().toLowerCase();
  return !['off', 'false', '0', 'no'].includes(value);
}

/** Resolved target, re-read from env on every call so a deploy can change it. */
export function serviceTarget(url = process.env.ML_SERVICE_URL || DEFAULT_SERVICE_URL) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = new URL(DEFAULT_SERVICE_URL);
  }
  const health = new URL(parsed.toString());
  health.pathname = '/health';
  health.search = '';
  return {
    url: parsed.toString(),
    host: parsed.hostname || '127.0.0.1',
    port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 8501)),
    healthUrl: health.toString(),
    remote: isRemoteUrl(url)
  };
}

const BOOT_BUDGET_MS = 300000; // model + Sentence-BERT load is slow (75s+ measured); never respawn inside this window
const MAX_FAILED_STARTS = 5;

const state = {
  enabled: adapterEnabled(),
  child: null,
  starting: null,   // in-flight start attempt
  waiter: null,     // in-flight ensure call shared by concurrent requests
  spawnedAt: 0,     // set while an engine we spawned has not finished booting
  nextAttemptAt: 0, // watcher backoff after a failed start; a request can still force one
  failures: 0,
  spawnCount: 0,
  watcher: null,
  lastLogMessage: ''
};

function log(msg) {
  if (msg === state.lastLogMessage) return; // collapse repeats
  state.lastLogMessage = msg;
  console.log(`[ml-supervisor] ${msg}`);
}

/** Windows venv layout first, then POSIX, then PATH. */
export function findPython() {
  const candidates = [
    process.env.PYTHON_BIN,
    path.join(ML_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(ML_DIR, '.venv', 'bin', 'python'),
    'python'
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) return candidate; // resolved from PATH
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function probeHealth(timeoutMs = 1500) {
  const { healthUrl } = serviceTarget();
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    // /health answers 200 while artifacts load, so require real readiness.
    return body?.artifactsLoaded === true;
  } catch {
    return false;
  }
}

function portOpen({ host, port }, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth()) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return probeHealth();
}

function spawnService() {
  if (state.child) return true; // one boot at a time
  if (!engineManagementEnabled()) {
    log('ML_MANAGE_ENGINE=off — this process never starts the engine (the platform owns it).');
    return false;
  }
  const target = serviceTarget();
  if (target.remote) {
    // Hosted engine: the platform starts and restarts it, not this process.
    log(`refusing to spawn a local engine: ML_SERVICE_URL points at a remote host (${target.host}).`);
    return false;
  }
  const python = findPython();
  if (!python) {
    state.failures += 1;
    log(`cannot start engine: no Python found (expected ml/.venv/Scripts/python.exe or ml/.venv/bin/python). Install ml/requirements.txt first.`);
    return false;
  }
  if (!fs.existsSync(path.join(ML_DIR, ENTRY))) {
    state.failures += 1;
    log(`cannot start engine: ml/${ENTRY} is missing.`);
    return false;
  }

  let fd = 'ignore';
  try {
    fd = fs.openSync(LOG_FILE, 'a');
  } catch {
    /* log file is optional */
  }

  try {
    const child = spawn(python, [ENTRY], {
      cwd: ML_DIR,
      env: {
        ...process.env,
        ML_SERVICE_HOST: target.host,
        ML_SERVICE_PORT: String(target.port),
        PYTHONUNBUFFERED: '1'
      },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd === 'ignore' ? 'ignore' : fd, fd === 'ignore' ? 'ignore' : fd]
    });
    if (typeof fd === 'number') fs.closeSync(fd);

    child.on('error', (err) => {
      state.child = null;
      state.spawnedAt = 0;
      state.failures += 1;
      log(`engine spawn failed: ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      state.child = null;
      state.spawnedAt = 0;
      state.failures += 1;
      state.nextAttemptAt = Date.now() + Math.min(30000, 5000 * Math.max(1, state.failures));
      const why = signal ? `signal ${signal}` : `code ${code}`;
      if (state.failures <= MAX_FAILED_STARTS) {
        log(`engine exited during startup (${why}); will retry. See ${path.relative(ROOT, LOG_FILE)}.`);
      } else {
        log(`engine keeps failing (${why}); giving up after ${MAX_FAILED_STARTS} attempts. See ${path.relative(ROOT, LOG_FILE)}.`);
      }
    });
    child.unref();

    state.child = child;
    state.spawnedAt = Date.now();
    state.spawnCount += 1;
    log(`starting engine (pid ${child.pid}): ${path.basename(python)} ${ENTRY} → ${path.relative(ROOT, LOG_FILE)}`);
    return true;
  } catch (err) {
    if (typeof fd === 'number') {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    state.failures += 1;
    log(`engine spawn failed: ${err.message}`);
    return false;
  }
}

/** True while an engine we started is still within its boot window. */
function isBooting() {
  return Boolean(state.child) && state.spawnedAt > 0 && Date.now() - state.spawnedAt < BOOT_BUDGET_MS;
}

/**
 * Single-flight: resolves when the engine answers a ready /health, starting it
 * if needed. Concurrent callers share one start attempt.
 */
export function ensureModelService({ waitMs = 30000 } = {}) {
  if (state.waiter) return state.waiter;

  const run = (async () => {
    const target = serviceTarget();
    if (await probeHealth()) {
      state.failures = 0;
      return true;
    }

    if (target.remote) {
      // Nothing to start remotely: wait for the hosted service to come back.
      if (waitMs <= 0) return false;
      const ok = await waitForHealthy(waitMs);
      if (ok) { state.failures = 0; log(`remote engine ${target.host} healthy.`); }
      else log(`remote engine ${target.host} did not become healthy within ${Math.round(waitMs / 1000)}s.`);
      return ok;
    }

    if (!engineManagementEnabled()) {
      // The container entrypoint starts the engine: wait for its /health, never spawn.
      if (waitMs <= 0) return false;
      const managed = await waitForHealthy(waitMs);
      log(managed
        ? `engine ${target.host} healthy (management disabled).`
        : `engine ${target.host} not healthy after ${Math.round(waitMs / 1000)}s (management disabled).`);
      return managed;
    }

    if (state.failures >= MAX_FAILED_STARTS) return false;

    // Engine already booting (ours, or another process holding the port): wait, never spawn twice.
    const booting = isBooting();
    if (!booting && !(await portOpen(target))) {
      if (!state.starting) state.starting = Promise.resolve().then(spawnService);
      await state.starting;
      state.starting = null;
    }
    if (waitMs <= 0) return false;

    const ok = await waitForHealthy(waitMs);
    if (ok) {
      state.failures = 0;
      state.spawnedAt = 0;
      log('engine healthy.');
    } else if (booting || state.child) {
      log(`engine still loading after ${Math.round(waitMs / 1000)}s; it will be ready shortly (logs: ${path.relative(ROOT, LOG_FILE)}).`);
    } else {
      log(`engine did not become healthy — see ${path.relative(ROOT, LOG_FILE)}.`);
    }
    return ok;
  })().finally(() => {
    state.waiter = null;
  });

  state.waiter = run;
  return run;
}

/** Boot hook: start the engine if needed, then keep it running. */
export function startSupervisor({ intervalMs = 5000 } = {}) {
  const target = serviceTarget();
  if (!adapterEnabled() || state.watcher) return state.watcher;
  if (!engineManagementEnabled()) {
    log(`ML_MANAGE_ENGINE=off — engine lifecycle is owned elsewhere; not watching ${target.healthUrl}.`);
    return null;
  }
  if (target.remote) {
    // Hosted ML: no spawned child, no watchdog, no port probing on the far side.
    log(`remote engine (${target.host}) — local spawning and watching disabled.`);
    return null;
  }
  log(`watching ${target.healthUrl}`);

  ensureModelService({ waitMs: 0 }).catch(() => {});

  state.watcher = setInterval(async () => {
    if (state.waiter || state.starting) return;       // a start is in flight
    if (isBooting()) return;                          // still loading
    if (Date.now() < state.nextAttemptAt) return;     // backing off after a failed start
    if (state.failures >= MAX_FAILED_STARTS) return;  // logged already; no fork storm
    if (await probeHealth()) {
      state.failures = 0;
      return;
    }
    if (await portOpen(serviceTarget())) return;      // someone else is binding it
    ensureModelService({ waitMs: 0 }).catch(() => {});
  }, intervalMs);
  if (typeof state.watcher.unref === 'function') state.watcher.unref();
  return state.watcher;
}

export function supervisorStatus() {
  const target = serviceTarget();
  return {
    enabled: adapterEnabled(),
    managed: engineManagementEnabled(),
    remote: target.remote,
    canSpawn: !target.remote && engineManagementEnabled(),
    healthUrl: target.healthUrl,
    booting: isBooting(),
    restarts: state.spawnCount,
    failures: state.failures,
    logFile: path.relative(ROOT, LOG_FILE),
    python: target.remote ? null : findPython()
  };
}

/** Only a refused/reset connection is worth self-healing; everything else is reported as-is. */
export function isConnectionRefused(err) {
  const code = err?.cause?.code || err?.code;
  return code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ECONNRESET';
}
