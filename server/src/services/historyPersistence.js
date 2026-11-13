/**
 * Durable mirror for prediction history.
 *
 * Render's filesystem is ephemeral (a paid disk is the only way to keep files),
 * so on a hosted deploy the JSON history file disappears on every restart. This
 * module supplies an optional durable backend: when MONGODB_URI is set, history
 * is mirrored to MongoDB Atlas — whose free M0 cluster costs nothing and is
 * ample for a small array of records.
 *
 * Design rules:
 *   - The JSON array is stored as ONE document, so the API contract (a single
 *     array of records) never changes and no schema migration is needed.
 *   - With no MONGODB_URI the store behaves exactly as before: the local file
 *     is the source of truth and nothing network-related is attempted.
 *   - The backend is created lazily and only on first use, so a missing or
 *     unreachable database degrades to the file instead of blocking boot.
 *   - Failures are recorded in `lastError` (surfaced on GET /api/health) and
 *     never thrown at the API: a prediction that really happened is still
 *     returned to the user.
 */
import { MongoClient } from 'mongodb';

const DEFAULT_DB = 'frd';
const DEFAULT_COLLECTION = 'prediction_history';
const DOC_ID = 'prediction-history';
const CONNECT_TIMEOUT_MS = 8000;

let injectedBackend = null; // test seam: avoids any real connection
let cached = null;          // { key, backend }
let lastError = null;

/** Deterministic backend used by tests (see historyPersistence.test.js). */
export function configureHistoryBackendForTests(backend) {
  injectedBackend = backend;
  cached = null;
}

export function resetHistoryBackendForTests() {
  injectedBackend = null;
  cached = null;
  lastError = null;
}

/** Remember a backend failure once, and log it once, instead of spamming. */
export function noteHistoryError(err) {
  const message = err?.message || String(err);
  if (message === lastError) return;
  lastError = message;
  console.warn(`[history] durable store unavailable, using the local file: ${message}`);
}

/**
 * The active durable backend, or null when history is file-only.
 * Cheap to call: it never connects and never awaits.
 */
export function historyBackend() {
  if (injectedBackend) return injectedBackend;
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  const key = `${uri}|${process.env.MONGODB_DB || DEFAULT_DB}|${DEFAULT_COLLECTION}`;
  if (cached?.key === key) return cached.backend;
  cached = { key, backend: mongoBackend(uri) };
  return cached.backend;
}

/** Reported on /api/health so a deploy can see whether history is durable. */
export function historyPersistenceStatus() {
  const backend = historyBackend();
  return {
    backend: backend ? backend.name : 'file',
    durable: Boolean(backend),
    lastError
  };
}

function mongoBackend(uri) {
  const dbName = process.env.MONGODB_DB || DEFAULT_DB;
  let clientPromise = null;

  const client = () => {
    if (!clientPromise) {
      const instance = new MongoClient(uri, {
        serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
        connectTimeoutMS: CONNECT_TIMEOUT_MS
      });
      clientPromise = instance.connect()
        .then(() => instance)
        .catch((err) => {
          clientPromise = null; // let the next attempt reconnect
          throw err;
        });
    }
    return clientPromise;
  };

  const collection = async () => (await client()).db(dbName).collection(DEFAULT_COLLECTION);

  return {
    name: 'mongodb',
    /** All records, or null when the document does not exist yet. */
    async read() {
      const doc = await (await collection()).findOne({ _id: DOC_ID });
      return Array.isArray(doc?.records) ? doc.records : null;
    },
    async write(records) {
      await (await collection()).updateOne(
        { _id: DOC_ID },
        { $set: { records, updatedAt: new Date() } },
        { upsert: true }
      );
      lastError = null; // a successful write clears a previous failure
    },
    async close() {
      if (!clientPromise) return;
      const instance = await clientPromise.catch(() => null);
      clientPromise = null;
      await instance?.close();
    }
  };
}
