import express from 'express';
import { predict, modelStatus, validateAnalyzeInput } from './mlAdapter.js';
import { noModelResult } from './services/analysisService.js';
import { loadHistory, appendHistory, appendHistoryBatch, clearHistory, loadSamples, computeStats, filterHistory } from './services/historyStore.js';
import { loadModelMetrics } from './services/metricsService.js';
import { trustHistogram, ratingCounts, sentimentCounts } from './utils/statsUtils.js';
import { serializeAnalysis } from './services/serializeAnalysis.js';
import { PRODUCT_CATEGORIES, normalizeProductMeta } from './services/productMeta.js';
import { MAX_BATCH, validateBatchRequest, validateEntry, runBatch } from './services/batchService.js';

export function createApiRouter() {
  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), service: 'explainable-fake-review-detection-api' });
  });

  api.get('/model/status', (_req, res) => {
    const status = modelStatus();
    res.json({
      ...status,
      message: status.connected
        ? 'ML inference service integrated.'
        : 'ML model not yet connected. The API returns NO predictions until the Python inference service is integrated. Numeric fields shown by the app are deterministic heuristic text measurements, not model output.'
    });
  });

  api.get('/samples', (_req, res) => {
    res.json({ samples: loadSamples() });
  });

  api.get('/categories', (_req, res) => {
    res.json({ categories: PRODUCT_CATEGORIES, maxBatch: MAX_BATCH });
  });

  api.get('/metrics/model-report', (_req, res) => {
    const m = loadModelMetrics();
    res.json({
      ...m,
      provenance: 'user-provided',
      note: 'Values are stored and shown exactly as provided by the project author; they are not recomputed or verified by this application.'
    });
  });

  api.get('/metrics/latest', (_req, res) => {
    const history = loadHistory();
    if (!history.length) {
      return res.status(404).json({
        error: 'NO_HISTORY',
        message: 'No analysis history yet. Charts populate after real model-connected analyses are recorded.'
      });
    }
    res.json({
      window: {
        totalAnalyses: history.length,
        firstAnalyzedAt: history[0]?.analyzedAt ?? null,
        lastAnalyzedAt: history[history.length - 1]?.analyzedAt ?? null
      },
      trustScoreDistribution: trustHistogram(history),
      ratingDistribution: ratingCounts(history),
      sentimentDistribution: sentimentCounts(history),
      modelConnected: modelStatus().connected
    });
  });

  api.get('/stats', (_req, res) => {
    res.json({ ...computeStats(loadHistory()), modelConnected: modelStatus().connected });
  });

  api.get('/history', (req, res) => {
    const { category, verdict } = req.query;
    if (verdict && !['fake', 'genuine'].includes(verdict)) {
      return res.status(400).json({ error: 'INVALID_FILTER', message: 'verdict must be fake or genuine.' });
    }
    res.json(filterHistory(loadHistory(), { category: category || undefined, verdict: verdict || undefined }));
  });

  api.delete('/history', (_req, res) => {
    clearHistory();
    res.status(204).end();
  });

  api.post('/analyze', async (req, res, next) => {
    const { errors, text, rating } = validateAnalyzeInput(req.body || {});
    const meta = normalizeProductMeta(req.body || {}, { requireCategory: false });
    errors.push(...meta.errors);
    if (errors.length) {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'Validation failed.', errors });
    }
    const t0 = Date.now();
    try {
      const result = await predict({ text, rating }); // throws ML_NOT_CONNECTED when adapter mode is 'none'
      appendHistory({
        id: 'h_' + Math.random().toString(36).slice(2, 10),
        text: text.slice(0, 200),
        rating,
        productName: meta.productName,
        productCategory: meta.productCategory,
        prediction: result.prediction,
        probabilities: result.probabilities,
        trustScore: result.trustScore,
        riskLevel: result.riskLevel,
        confidence: result.confidence,
        evidence: result.evidence ?? null,
        sentimentLabel: result.features?.sentiment?.label ?? null,
        ratingSentimentGap: result.ratingSentimentGap?.gap ?? null,
        modelVersion: result.model?.version ?? null,
        analyzedAt: new Date(t0).toISOString()
      });
      res.json(serializeAnalysis({ ...result, status: 'model_connected', text, rating, ...meta, analyzedAt: new Date(t0).toISOString(), requestTimeMs: Date.now() - t0 }));
    } catch (err) {
      if (err.code === 'ML_NOT_CONNECTED') {
        return res.json(serializeAnalysis({ ...noModelResult(text, rating, t0), text, rating, ...meta, requestTimeMs: Date.now() - t0 }));
      }
      next(err);
    }
  });

  // Multi-review batch: validates every entry independently, runs the SAME
  // trained predictor per entry with bounded concurrency, and associates each
  // result to its entry by ref/index. Partial failures never lose successes.
  api.post('/analyze/batch', async (req, res, next) => {
    const { errors, reviews } = validateBatchRequest(req.body || {});
    if (errors.length) {
      return res.status(400).json({ error: 'INVALID_BATCH', message: 'Batch validation failed.', errors });
    }
    const entries = [];
    const invalid = [];
    reviews.forEach((raw, i) => {
      const e = validateEntry(raw, i);
      if (e.errors.length) invalid.push({ ref: e.ref, index: e.index, status: 'invalid', errors: e.errors });
      else entries.push(e);
    });
    try {
      const { batchId, results, records } = await runBatch(entries);
      appendHistoryBatch(records);
      const resultMap = new Map(results.map((r) => [r.index, r]));
      const all = reviews.map((_, i) => resultMap.get(i) || invalid.find((v) => v.index === i));
      const completed = all.filter((r) => r.status === 'completed' && r.analysis?.prediction);
      res.json({
        batchId,
        summary: {
          submitted: reviews.length,
          invalid: invalid.length,
          completed: all.filter((r) => r.status === 'completed').length,
          predicted: completed.length,
          failed: all.filter((r) => r.status === 'failed').length,
          fake: completed.filter((r) => r.analysis.prediction === 'fake').length,
          genuine: completed.filter((r) => r.analysis.prediction === 'genuine').length,
          note: 'Fake/Genuine counts are model outputs — not independently verified truth labels.'
        },
        results: all
      });
    } catch (err) {
      next(err);
    }
  });

  api.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `No route: ${req.method} ${req.originalUrl}` });
  });

  api.use((err, _req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json({
      error: err.code || 'SERVER_ERROR',
      message: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  });

  return api;
}
