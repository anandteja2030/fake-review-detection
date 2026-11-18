/**
 * Deterministic text heuristics — mirrors server/src/services/analysisService.js
 * and server/src/utils/heuristics.js so the browser engine returns the SAME
 * `features` / `ratingSentimentGap` / `clarifyingSignals` objects the Express
 * API produced. These are text measurements shown alongside the prediction;
 * they are NOT model output.
 */

export const POSITIVE_WORDS = new Set([
  'good', 'great', 'excellent', 'amazing', 'awesome', 'fantastic', 'wonderful', 'perfect', 'best',
  'love', 'loved', 'lovely', 'beautiful', 'brilliant', 'superb', 'outstanding', 'incredible',
  'recommend', 'recommended', 'recommendation', 'happy', 'satisfied', 'pleased', 'delightful',
  'impressed', 'impressive', 'premium', 'quality', 'reliable', 'worthy', 'worth', 'bargain', 'glad',
  'smooth', 'sturdy', 'comfortable', 'fast', 'efficient', 'flawless', 'must', 'bought', 'buy'
]);

export const NEGATIVE_WORDS = new Set([
  'bad', 'terrible', 'awful', 'horrible', 'worst', 'poor', 'disappointing', 'disappointed', 'disappointment',
  'hate', 'hated', 'broken', 'broke', 'defective', 'damaged', 'waste', 'useless', 'worthless', 'cheap',
  'unreliable', 'slow', 'uncomfortable', 'flimsy', 'fail', 'failed', 'failure', 'refund', 'return', 'returned',
  'regret', 'scam', 'fake', 'faulty', 'snap', 'cracked', 'stopped', 'never', 'avoid', 'unhappy', 'sad', 'angry'
]);

export const PROMOTIONAL_PATTERNS = [
  /\bhighly recommended\b/i, /\bmust buy\b/i, /\bmust have\b/i, /\bbest (purchase|product|deal|price)\b/i,
  /\b(stop|don't|do not) (wait|hesitate|scroll)[!.]?\b/i, /\blimited time\b/i, /\bact now\b/i,
  /\bdelete (this )?review\b/i, /\bdisclaimer: i (received|was given|got)\b/i, /\bfive stars?\b/i,
  /\bchanged my life\b/i, /\blife[- ]saver\b/i, /\bgodsend\b/i, /\blife[- ]changing\b/i,
  /\b100% (satisfied|guaranteed|recommend)\b/i, /\bincredible value\b/i, /\bresponse direct(ly)? from\b/i,
  /\bgame[- ]changer\b/i, /\bunbeatable\b/i, /\bbuy (it|now)!\b/i
];

export const CERTAINTY_WORDS = new Set([
  'definitely', 'absolutely', 'totally', 'completely', 'certainly', 'obviously', 'undoubtedly',
  'perfectly', 'literally', 'extremely', 'amazingly', 'wonderfully', 'one hundred'
]);

const round2 = (x) => Math.round(x * 100) / 100;

export const cleanText = (text) => String(text || '')
  .replace(/http\S+|www\.\S+/g, ' ')
  .replace(/[^\p{L}\p{N}'\- \s,.;:!?%]/gu, ' ')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

export const tokenize = (text) => (cleanText(text) ? cleanText(text).split(' ') : []);
export const countMatches = (words, set) => words.reduce((n, w) => (set.has(w) ? n + 1 : n), 0);

export const patternFlags = (text) => PROMOTIONAL_PATTERNS
  .map((p) => ({ pattern: p.source, sample: (text.match(p) || [])[0] || null }))
  .filter((m) => m.sample !== null);

export function sentiment(text) {
  const words = tokenize(text);
  const pos = countMatches(words, POSITIVE_WORDS);
  const neg = countMatches(words, NEGATIVE_WORDS);
  const total = pos + neg;
  return {
    label: total === 0 ? 'neutral' : pos > neg ? 'positive' : neg > pos ? 'negative' : 'mixed',
    positiveHits: pos,
    negativeHits: neg,
    coverage: round2(words.length ? total / words.length : 0)
  };
}

function repetitionRatio(tokens) {
  if (tokens.length === 0) return 0;
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  let excess = 0;
  for (const c of counts.values()) if (c > 1) excess += c - 1;
  return round2(excess / tokens.length);
}

function posNegSwing(review, word) {
  const idx = review.toLowerCase().indexOf(word);
  const window = review.toLowerCase().slice(Math.max(0, idx - 40), idx + 40);
  return /!/.test(window) || countMatches(tokenize(window), POSITIVE_WORDS) >= 2;
}

function suspiciousWords(review, rawWords) {
  const lower = review.toLowerCase();
  const out = [];
  for (const w of rawWords) {
    if (w.length < 4) continue;
    const strongPromo = ['highly', 'recommended', 'amazing', 'perfect', 'incredible', 'unbeatable'];
    const strongCert = ['definitely', 'absolutely', 'totally', 'literally', 'obviously'];
    if (strongPromo.includes(w) || strongCert.includes(w) || CERTAINTY_WORDS.has(w)) {
      out.push({ word: w, reason: 'promotional or certainty language' });
    } else if (POSITIVE_WORDS.has(w)
      && !cleanText(review).split(' ').slice(0, 3).includes(w)
      && lower.split(w).length - 1 > 0
      && countMatches([w], NEGATIVE_WORDS) === 0
      && posNegSwing(review, w)) {
      out.push({ word: w, reason: 'strong positive word — flagged only when paired with other signals, not as a prediction' });
    }
  }
  return out;
}

function clarifyingSignals(f) {
  const s = [];
  if (f.reviewLength.words <= 25 && f.rating >= 4) s.push({ id: 'short-four-plus', note: `Very short ${f.rating}★ review — model will check rating/sentiment correlation.` });
  if (f.promoHits > 0) s.push({ id: 'promotional', note: `${f.promoHits} promotional phrase${f.promoHits === 1 ? '' : 's'} flagged by heuristics.` });
  if (f.repetitionRatio > 0.15) s.push({ id: 'repetition', note: `High word repetition (ratio ${f.repetitionRatio}).` });
  if (f.sentimentLabel === 'positive' && f.rating <= 2) s.push({ id: 'rating-gap', note: 'Positive wording with a low star rating — rating/sentiment gap.' });
  if (f.sentimentLabel === 'negative' && f.rating >= 5) s.push({ id: 'rating-gap', note: 'Negative wording with a 5★ rating — rating/sentiment gap.' });
  if (s.length === 0) s.push({ id: 'no-flags', note: 'No heuristic flags; the trained model will make the real decision.' });
  return s;
}

export function computeFeatures(reviewText, rating) {
  const review = String(reviewText || '');
  const rawTokens = tokenize(review);
  const rawWords = String(review).toLowerCase().match(/[a-z']+/g) || [];
  const exclamations = (review.match(/!/g) || []).length;
  const capsWords = (review.match(/\b[A-Z]{3,}\b/g) || []).length;
  const sent = sentiment(review);
  const features = {
    reviewLength: {
      characters: review.length,
      words: rawTokens.length,
      sentences: (review.match(/[.!?]+/g) || []).length || (review.trim() ? 1 : 0)
    },
    repetitionRatio: repetitionRatio(rawTokens),
    sentiment: sent,
    promoHits: patternFlags(review).length,
    suspicionScore: 0,
    certaintyWords: countMatches(rawWords, CERTAINTY_WORDS)
  };
  features.exclamationCount = exclamations;
  features.capsWords = capsWords;
  features.promoFlags = patternFlags(review);
  features.suspiciousWordList = suspiciousWords(review, [...new Set(rawWords)]);
  features.suspicionScore = round2(Math.min(1,
    0.18 * features.promoHits
    + 0.05 * Math.min(exclamations, 6)
    + 0.04 * Math.min(capsWords, 5)
    + 0.6 * features.repetitionRatio
    + 0.06 * features.certaintyWords));
  return features;
}

export function ratingSentimentGap(reviewText, rating) {
  const s = sentiment(reviewText);
  const gap = Math.abs((rating - 3) / 2 - (s.positiveHits >= s.negativeHits ? 1 : s.positiveHits === s.negativeHits ? 0.5 : 0));
  return { rating, sentimentLabel: s.label, gap: round2(gap), aligned: gap <= 0.5 };
}

export { clarifyingSignals };
