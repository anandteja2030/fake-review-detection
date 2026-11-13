import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate from the deployment's real history file, and make sure no durable
// backend is inherited from the developer's own environment.
const TEST_HISTORY = path.join(os.tmpdir(), `afrd-persist-${process.pid}.json`);
process.env.AFRD_HISTORY_FILE = TEST_HISTORY;
delete process.env.MONGODB_URI;

const { createApp } = await import('../src/app.js');
const store = await import('../src/services/historyStore.js');
const persistence = await import('../src/services/historyPersistence.js');

const record = (id, over = {}) => ({
  id, text: `review ${id}`, rating: 4, prediction: 'genuine',
  probabilities: { fake: 0.1, genuine: 0.9 }, trustScore: 90,
  analyzedAt: '2026-01-01T00:00:00.000Z', ...over
});

/** In-memory stand-in for the MongoDB document; supports injected failures. */
function fakeBackend({ initial = [], failRead = false, failWrite = false } = {}) {
  const state = { records: initial === null ? null : [...initial], reads: 0, writes: 0, failWrite };
  return {
    name: 'fake-mongodb',
    state,
    async read() {
      state.reads += 1;
      if (failRead) throw new Error('read down');
      return state.records === null ? null : state.records.map((r) => ({ ...r }));
    },
    async write(records) {
      state.writes += 1;
      if (state.failWrite) throw new Error('write down');
      state.records = records.map((r) => ({ ...r }));
    }
  };
}

function reset(fileContents = []) {
  persistence.resetHistoryBackendForTests();
  store.__resetHistoryForTests();
  fs.writeFileSync(TEST_HISTORY, JSON.stringify(fileContents, null, 2));
}

const app = createApp();
let base;
let server;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(() => {
  server?.close();
  fs.rmSync(TEST_HISTORY, { force: true });
});

const ids = (rows) => rows.map((r) => r.id);

test('MONGODB_URI selects the durable backend without connecting eagerly', () => {
  reset();
  process.env.MONGODB_URI = 'mongodb+srv://user:secret@example.invalid/frd';
  try {
    const status = persistence.historyPersistenceStatus();
    assert.equal(status.backend, 'mongodb');
    assert.equal(status.durable, true);
  } finally {
    delete process.env.MONGODB_URI;
    persistence.resetHistoryBackendForTests();
  }
});

test('without MONGODB_URI history stays file-only and the JSON contract is unchanged', async () => {
  reset();
  assert.equal(persistence.historyBackend(), null);

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.status, 'ok');
  assert.deepEqual(health.history, { backend: 'file', durable: false, lastError: null });

  const list = await (await fetch(`${base}/history`)).json();
  assert.equal(Array.isArray(list), true);
  assert.equal(list.length, 0);

  const del = await fetch(`${base}/history`, { method: 'DELETE' });
  assert.equal(del.status, 204);
});

test('history is hydrated from the durable store instead of the empty file', async () => {
  const backend = fakeBackend({ initial: [record('r1'), record('r2')] });
  reset();
  persistence.configureHistoryBackendForTests(backend);

  const list = await (await fetch(`${base}/history`)).json();
  assert.deepEqual(ids(list), ['r1', 'r2']);
  assert.equal(backend.state.reads, 1, 'the store is read once per process');
  assert.equal(backend.state.records.length, 2, 'hydrating never rewrites the store');
});

test('an append is mirrored before the response, so a 200 means durable', async () => {
  const backend = fakeBackend();
  reset();
  persistence.configureHistoryBackendForTests(backend);

  await store.appendHistory(record('r3'));
  assert.equal(backend.state.writes, 1);
  assert.deepEqual(ids(backend.state.records), ['r3']);

  const list = await (await fetch(`${base}/history`)).json();
  assert.deepEqual(ids(list), ['r3']);

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.history.durable, true);
});

test('a fresh store is seeded from the existing file (one-time migration)', async () => {
  const backend = fakeBackend({ initial: null });
  reset([record('legacy1')]);
  persistence.configureHistoryBackendForTests(backend);

  const list = await (await fetch(`${base}/history`)).json();
  assert.deepEqual(ids(list), ['legacy1']);
  assert.deepEqual(ids(backend.state.records), ['legacy1'], 'the file history was lifted into the store');
});

test('clearing history clears the durable store too', async () => {
  const backend = fakeBackend({ initial: [record('r1'), record('r2')] });
  reset();
  persistence.configureHistoryBackendForTests(backend);

  const del = await fetch(`${base}/history`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  assert.deepEqual(backend.state.records, []);
  assert.deepEqual(await (await fetch(`${base}/history`)).json(), []);
});

test('a failing durable store never breaks the API or loses the local record', async () => {
  const backend = fakeBackend({ failWrite: true });
  reset();
  persistence.configureHistoryBackendForTests(backend);

  await store.appendHistory(record('r5'));

  const list = await (await fetch(`${base}/history`)).json();
  assert.deepEqual(ids(list), ['r5'], 'the real record is still returned');
  assert.equal(list[0].prediction, 'genuine');

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.history.durable, true, 'the backend is still configured');
  assert.match(health.history.lastError || '', /write down/, 'the failure is reported, not hidden');
});

test('a read failure falls back to the local file instead of failing the request', async () => {
  const backend = fakeBackend({ failRead: true });
  reset([record('local1')]);
  persistence.configureHistoryBackendForTests(backend);

  const list = await (await fetch(`${base}/history`)).json();
  assert.deepEqual(ids(list), ['local1']);
  const health = await (await fetch(`${base}/health`)).json();
  assert.match(health.history.lastError || '', /read down/);
});

test('concurrent appends are serialised: no lost update, no duplicate', async () => {
  const backend = fakeBackend();
  reset();
  persistence.configureHistoryBackendForTests(backend);

  await Promise.all([
    store.appendHistory(record('a')),
    store.appendHistory(record('b')),
    store.appendHistoryBatch([record('c'), record('d')])
  ]);

  const list = await (await fetch(`${base}/history`)).json();
  assert.deepEqual(ids(list).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(backend.state.records).sort(), ['a', 'b', 'c', 'd']);
});

test('stats and metrics read the hydrated history, not the empty file', async () => {
  const backend = fakeBackend({
    initial: [
      record('m1', { prediction: 'fake', trustScore: 10, productCategory: 'Electronics' }),
      record('m2', { prediction: 'genuine', trustScore: 90, productCategory: 'Toys and Games' })
    ]
  });
  reset();
  persistence.configureHistoryBackendForTests(backend);

  const stats = await (await fetch(`${base}/stats`)).json();
  assert.equal(stats.totalReviews, 2);
  assert.equal(stats.fake, 1);
  assert.equal(stats.genuine, 1);

  const metrics = await (await fetch(`${base}/metrics/latest`)).json();
  assert.equal(metrics.window.totalAnalyses, 2);
  assert.equal(metrics.window.lastAnalyzedAt, '2026-01-01T00:00:00.000Z');
});
