import { countMatches, cleanText, tokenize, patternFlags,
         POSITIVE_WORDS, NEGATIVE_WORDS, CERTAINTY_WORDS } from '../utils/heuristics.js';


/* Deterministic text heuristics on real input — supports the UI, NOT a model prediction. */

const round2 = (x) => Math.round(x * 100) / 100;

function sentiment(text) {
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

function suspiciousWords(review, rawWords) {
  const lower = review.toLowerCase();
  const out = [];
  for (const w of rawWords) {
    if (w.length < 4) continue;
    const strongPromo = ['highly', 'recommended', 'amazing', 'perfect', 'incredible', 'unbeatable'];
    const strongCert = ['definitely', 'absolutely', 'totally', 'literally', 'obviously'];
    if (strongPromo.includes(w) || strongCert.includes(w) || CERTAINTY_WORDS.has(w)) out.push({ word: w, reason: 'promotional or certainty language' });
    else if (POSITIVE_WORDS.has(w) && !cleanText(review).split(' ').slice(0, 3).includes(w) && lower.split(w).length - 1 > 0 && countMatches([w], NEGATIVE_WORDS) === 0 && posNegSwing(review, w)) out.push({ word: w, reason: 'strong positive word — flagged only when paired with other signals, not as a prediction' });
  }
  return out;
}

function posNegSwing(review, word) {
  const idx = review.toLowerCase().indexOf(word);
  const window = review.toLowerCase().slice(Math.max(0, idx - 40), idx + 40);
  return /!/.test(window) || countMatches(tokenize(window), POSITIVE_WORDS) >= 2;
}

function clarifyingSignals(f) {
  const s = [];
  if (f.reviewLength.words <= 25 && f.rating >= 4) s.push({ id: 'short-four-plus', note: `Very short ${f.rating}★ review — model will check rating/sentiment correlation.` });
  if (f.promoHits > 0) s.push({ id: 'promotional', note: `${f.promoHits} promotional phrase${f.promoHits === 1 ? '' : 's'} flagged by heuristics.` });
  if (f.repetitionRatio > 0.15) s.push({ id: 'repetition', note: `High word repetition (ratio ${f.repetitionRatio}).` });
  if (f.sentimentLabel === 'positive' && f.rating <= 2) s.push({ id: 'rating-gap', note: 'Positive wording with a low star rating — rating/sentiment gap.' });
  if (f.sentimentLabel === 'negative' && f.rating >= 5) s.push({ id: 'rating-gap', note: 'Negative wording with a 5★ rating — rating/sentiment gap.' });
  if (s.length === 0) s.push({ id: 'no-flags', note: 'No heuristic flags; the trained model will make the real dec' + 'ision.' });
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
    reviewLength: { characters: review.length, words: rawTokens.length, sentences: (review.match(/[.!?]+/g) || []).length || (review.trim() ? 1 : 0) },
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
  features.suspicionScore = round2(
    Math.min(1,
      0.18 * features.promoHits +
      0.05 * Math.min(exclamations, 6) +
      0.04 * Math.min(capsWords, 5) +
      0.6 * features.repetitionRatio +
      0.06 * features.certaintyWords)
  );
  return features;
}

export function ratingSentimentGap(reviewText, rating) {
  const s = sentiment(reviewText);
  const gap = Math.abs((rating - 3) / 2 - (s.positiveHits >= s.negativeHits ? 1 : s.positiveHits === s.negativeHits ? 0.5 : 0));
  return { rating, sentimentLabel: s.label, gap: round2(gap), aligned: gap <= 0.5 };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function noModelResult(reviewText, rating, requestTime) {
  const features = computeFeatures(reviewText, rating);
  const gap = ratingSentimentGap(reviewText, rating);
  return {
    prediction: null,
    status: 'model_not_connected',
    message: 'The trained ML model is not yet connected. Displayed features are deterministic heuristic computations on your text — they are NOT predictions.',
    probabilities: null,
    trustScore: null,
    riskLevel: null,
    confidence: null,
    features,
    ratingSentimentGap: gap,
    semanticSimilarity: null,
    clarifyingSignals: clarifyingSignals({ ...features, rating }),
    model: { name: 'not-connected', id: null, version: null },
    requestTimeMs: Date.now() - requestTime,
    analyzedAt: new Date(requestTime).toISOString()
  };
}
