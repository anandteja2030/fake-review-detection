import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UNCATEGORIZED } from './productMeta.js';
import { historyBackend, noteHistoryError } from './historyPersistence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_HISTORY_FILE = path.join(DATA_DIR, 'prediction_history.json');
const SAMPLES_FILE = path.join(DATA_DIR, 'review_samples.json');

// Read lazily so tests can isolate themselves from the deployment's real
// history (AFRD_HISTORY_FILE) before any request is served.
const historyFile = () => process.env.AFRD_HISTORY_FILE || DEFAULT_HISTORY_FILE;

function ensureFile(file, initial) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readFileRecords() {
  const file = historyFile();
  ensureFile(file, []);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[history] unreadable history file (${file}): ${err.message}`);
    return [];
  }
}

/** mtime+size of the history file: detects edits made outside this process. */
function stampOf(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

function writeFileRecords(records) {
  const file = historyFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(records, null, 2), 'utf8');
    cacheStamp = stampOf(file);
  } catch (err) {
    // Without a durable backend the file IS the store, so a write failure must
    // surface. With one, the record is still mirrored and the file is a cache.
    if (!historyBackend()) throw err;
    noteHistoryError(err);
  }
}

/* ------------------------------------------------------------------ *
 * In-memory copy + durable mirror
 * ------------------------------------------------------------------ */
let cache = null;                    // authoritative array once hydrated
let cacheStamp = null;               // file mtime:size the cache was built from
let hydration = null;                // in-flight first read (shared by callers)
let mutations = Promise.resolve();   // serialises read-modify-write cycles
let writeQueue = Promise.resolve();  // serialises mirror writes

/**
 * Load history once per process: from the durable backend when configured,
 * otherwise from the local file. Later appends/clears update this copy, so the
 * synchronous `loadHistory()` below stays usable inside route handlers.
 */
export async function ensureHistoryHydrated() {
  if (cache) return cache;
  if (!hydration) {
    hydration = hydrate()
      .catch((err) => {
        noteHistoryError(err);
        cache = cache ?? readFileRecords();
        return cache;
      })
      .finally(() => { hydration = null; });
  }
  return hydration;
}

function setCache(records) {
  cache = records;
  cacheStamp = stampOf(historyFile());
  return cache;
}

async function hydrate() {
  const local = readFileRecords();
  const backend = historyBackend();
  if (!backend) return setCache(local);

  let remote;
  try {
    remote = await backend.read();
  } catch (err) {
    noteHistoryError(err);
    return setCache(local);
  }

  if (remote === null) {
    // Fresh store: adopt the existing file so a running deployment's history
    // migrates instead of vanishing the first time MONGODB_URI is configured.
    try {
      await backend.write(local);
    } catch (err) {
      noteHistoryError(err);
    }
    return setCache(local);
  }

  cache = remote;
  writeFileRecords(remote); // keep the local copy warm for debugging/export
  return setCache(remote);
}

/**
 * Synchronous read of the current history (hydrate first in async handlers).
 * An edit made to the JSON file outside this process wins: hand-editing the
 * file stays a supported way to inspect or repair history.
 */
export function loadHistory() {
  if (!cache) return readFileRecords();
  const stamp = stampOf(historyFile());
  if (stamp && cacheStamp && stamp !== cacheStamp) {
    cache = readFileRecords();
    cacheStamp = stamp;
  }
  return cache;
}

function persist(records) {
  const backend = historyBackend();
  if (!backend) return Promise.resolve();
  // A failed mirror must never fail the request: the record really happened.
  writeQueue = writeQueue.then(() => backend.write(records)).catch(noteHistoryError);
  return writeQueue;
}

function mutate(fn) {
  const run = mutations.then(fn, fn);
  mutations = run.then(() => undefined, () => undefined);
  return run;
}

export function appendHistory(record) {
  return mutate(async () => {
    await ensureHistoryHydrated();
    const next = [...(cache ?? []), record];
    cache = next;
    writeFileRecords(next);
    await persist(next); // awaited: a 200 means the record is durable
    return record;
  });
}

/** Atomically append many records (single write) so batch results never interleave. */
export function appendHistoryBatch(records) {
  if (!records.length) return Promise.resolve([]);
  return mutate(async () => {
    await ensureHistoryHydrated();
    const next = [...(cache ?? []), ...records];
    cache = next;
    writeFileRecords(next);
    await persist(next);
    return records;
  });
}

export function clearHistory() {
  return mutate(async () => {
    await ensureHistoryHydrated();
    cache = [];
    writeFileRecords([]);
    await persist([]);
  });
}

/** Test-only: drop the in-process copy so the next read re-hydrates. */
export function __resetHistoryForTests() {
  cache = null;
  cacheStamp = null;
  hydration = null;
  mutations = Promise.resolve();
  writeQueue = Promise.resolve();
}

/**
 * Filter history by product category and/or verdict.
 * Records stored before metadata existed fall back to 'Uncategorized'.
 * `category=Uncategorized` matches records with no stored category.
 */
export function filterHistory(history, { category, verdict } = {}) {
  return history.filter((h) => {
    if (verdict && h.prediction !== verdict) return false;
    if (category) {
      const hCat = h.productCategory || UNCATEGORIZED;
      if (hCat !== category) return false;
    }
    return true;
  });
}

export function loadSamples() {
  ensureFile(SAMPLES_FILE, []);
  return JSON.parse(fs.readFileSync(SAMPLES_FILE, 'utf8'));
}

export function computeStats(history) {
  const total = history.length;
  const count = (label) => history.filter((h) => h.prediction === label).length;
  const scored = history.filter((h) => typeof h.trustScore === 'number');
  const avgTrust = scored.length ? scopedRound(scored.reduce((s, h) => s + h.trustScore, 0) / scored.length, 1) : null;
  const ratings = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const h of history) if (ratings[h.rating] !== undefined) ratings[h.rating]++;
  const sentiments = {};
  for (const h of history) if (h.sentimentLabel) sentiments[h.sentimentLabel] = (sentiments[h.sentimentLabel] || 0) + 1;
  // Real category distribution — records without metadata count as Uncategorized.
  const categories = {};
  for (const h of history) {
    const c = h.productCategory || UNCATEGORIZED;
    categories[c] = (categories[c] || 0) + 1;
  }
  return {
    totalReviews: total,
    fake: count('fake'),
    genuine: count('genuine'),
    notPredicted: total - (count('fake') + count('genuine')),
    averageTrustScore: avgTrust,
    ratingDistribution: ratings,
    sentimentDistribution: sentiments,
    categoryDistribution: categories
  };
}

const scopedRound = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
