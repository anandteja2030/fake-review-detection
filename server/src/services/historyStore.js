import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UNCATEGORIZED } from './productMeta.js';

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

export function loadHistory() { const f = historyFile(); ensureFile(f, []); return JSON.parse(fs.readFileSync(f, 'utf8')); }

export function appendHistory(record) {
  const history = loadHistory();
  history.push(record);
  fs.writeFileSync(historyFile(), JSON.stringify(history, null, 2), 'utf8');
  return record;
}

/** Atomically append many records (single write) so batch results never interleave. */
export function appendHistoryBatch(records) {
  if (!records.length) return [];
  const history = loadHistory();
  history.push(...records);
  fs.writeFileSync(historyFile(), JSON.stringify(history, null, 2), 'utf8');
  return records;
}

export function clearHistory() { fs.writeFileSync(historyFile(), '[]', 'utf8'); }

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
