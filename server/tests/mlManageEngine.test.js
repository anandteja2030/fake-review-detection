import test from 'node:test';
import assert from 'node:assert/strict';

import { startSupervisor, supervisorStatus, engineManagementEnabled } from '../src/mlSupervisor.js';

async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// A loopback URL is "local", so without this switch the supervisor would spawn a
// second Python engine. Inside the container that collides with the entrypoint's
// uvicorn on port 8501 and the container dies — the exact failure this protects.
test('ML_MANAGE_ENGINE=off disables local engine management', async () => {
  await withEnv(
    { ML_ADAPTER_MODE: 'python-http', ML_SERVICE_URL: 'http://127.0.0.1:8591/predict', ML_MANAGE_ENGINE: 'off' },
    async () => {
      assert.equal(engineManagementEnabled(), false);
      assert.equal(supervisorStatus().managed, false);
      assert.equal(supervisorStatus().canSpawn, false, 'must not offer to spawn inside the container layout');
      assert.equal(startSupervisor(), null, 'no watcher may be installed');
    }
  );
});

test('engine management stays enabled by default (local development)', async () => {
  await withEnv(
    { ML_ADAPTER_MODE: 'python-http', ML_SERVICE_URL: 'http://127.0.0.1:8591/predict', ML_MANAGE_ENGINE: undefined },
    async () => {
      assert.equal(engineManagementEnabled(), true);
      assert.equal(supervisorStatus().managed, true);
      assert.equal(supervisorStatus().canSpawn, true);
    }
  );
});

test('only explicit off values disable it', async () => {
  for (const off of ['off', 'OFF', 'false', '0', 'no']) {
    await withEnv({ ML_MANAGE_ENGINE: off }, async () => {
      assert.equal(engineManagementEnabled(), false, `${off} should disable`);
    });
  }
  for (const on of ['on', 'true', '1', '', 'anything']) {
    await withEnv({ ML_MANAGE_ENGINE: on }, async () => {
      assert.equal(engineManagementEnabled(), true, `${on} should keep it enabled`);
    });
  }
});
