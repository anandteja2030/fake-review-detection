/**
 * Batch analysis orchestration.
 *
 * Invokes the SAME existing predictor (mlAdapter.predict) once per review with
 * bounded concurrency. Partial failures never discard successful results and
 * never write fabricated predictions to history.
 */
import crypto from 'crypto';
import { predict } from '../mlAdapter.js';
import { noModelResult } from './analysisService.js';
import { normalizeProductMeta } from './productMeta.js';
import { serializeAnalysis } from './serializeAnalysis.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Batch size limit — sized for the FastAPI service (each call ~0.3-1s, 10s timeout). */
export const MAX_BATCH = clamp(Number(process.env.BATCH_MAX_REVIEWS) || 10, 1, 20);
const CONCURRENCY = 3;

export function validateBatchRequest(body) {
  const errors = [];
  const reviews = body?.reviews;
  if (!Array.isArray(reviews)) {
    errors.push('reviews: expected an array of review entries');
  } else if (reviews.length === 0) {
    errors.push('reviews: at least one review entry is required');
  } else if (reviews.length > MAX_BATCH) {
    errors.push(`reviews: batch limit is ${MAX_BATCH} entries per request (received ${reviews.length})`);
  }
  return { errors, reviews: Array.isArray(reviews) ? reviews : [] };
}

/** Per-entry validation: text + rating + required product category, each entry independently. */
export function validateEntry(raw, index) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  let text = '';
  if (typeof body.text !== 'string' || body.text.trim().length === 0) {
    errors.push('text: review text is required and must be a non-empty string');
  } else {
    text = body.text;
    if (text.length > 20000) errors.push('text: exceeds 20000 character limit');
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.push('rating: integer 1-5 required');
  }
  const meta = normalizeProductMeta(body, { requireCategory: true });
  errors.push(...meta.errors);
  const ref = typeof body.ref === 'string' && body.ref.trim() ? body.ref.trim().slice(0, 64) : `e_${index}`;
  return { ref, index, errors, text, rating, productName: meta.productName, productCategory: meta.productCategory };
}

/**
 * Runs predictions for validated entries with bounded concurrency.
 * Returns { batchId, results, records } — `records` are history rows for
 * completed predictions only (model-connected or explicit not-connected state).
 */
export async function runBatch(entries) {
  const batchId = 'b_' + crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const results = new Array(entries.length);
  const records = [];
  let cursor = 0;

  async function worker() {
    while (cursor < entries.length) {
      const e = entries[cursor++];
      const t0 = Date.now();
      try {
        const result = await predict({ text: e.text, rating: e.rating });
        const analysis = serializeAnalysis({
          ...result,
          status: 'model_connected',
          text: e.text,
          rating: e.rating,
          productName: e.productName,
          productCategory: e.productCategory,
          analyzedAt: new Date(t0).toISOString(),
          requestTimeMs: Date.now() - t0
        });
        results[e.index] = { ref: e.ref, index: e.index, status: 'completed', analysis };
        records.push(historyRecord(e, analysis, batchId));
      } catch (err) {
        if (err.code === 'ML_NOT_CONNECTED') {
          // Honest no-prediction state — matches the single /analyze contract.
          const analysis = serializeAnalysis({
            ...noModelResult(e.text, e.rating, t0),
            text: e.text,
            rating: e.rating,
            productName: e.productName,
            productCategory: e.productCategory,
            requestTimeMs: Date.now() - t0
          });
          results[e.index] = { ref: e.ref, index: e.index, status: 'completed', analysis };
          // Intentionally NOT recorded: no real prediction exists.
        } else {
          results[e.index] = {
            ref: e.ref, index: e.index, status: 'failed',
            error: { code: err.code || 'SERVER_ERROR', message: err.message }
          };
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return { batchId, results, records };
}

function historyRecord(e, analysis, batchId) {
  return {
    id: 'h_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    batchId,
    entryRef: e.ref,
    text: e.text.slice(0, 200),
    rating: e.rating,
    productName: e.productName,
    productCategory: e.productCategory,
    prediction: analysis.prediction,
    probabilities: analysis.probabilities,
    trustScore: analysis.trustScore,
    riskLevel: analysis.riskLevel,
    confidence: analysis.confidence,
    evidence: analysis.evidence ?? null,
    sentimentLabel: analysis.features?.sentiment?.label ?? null,
    ratingSentimentGap: analysis.ratingSentimentGap?.gap ?? null,
    modelVersion: analysis.model?.version ?? null,
    analyzedAt: analysis.analyzedAt
  };
}
