import { api } from '../api/client.js';
import { saveSelection, selectionFromAnalysis, selectionFromHistory } from './evidenceStore.js';

/**
 * Persist a just-returned analysis as the current-analysis record.
 *
 * The prediction response carries no history id, so the record the server
 * stored moments earlier is matched on its exact timestamp, verdict and text
 * excerpt. Selecting that record — rather than a loose snapshot — is what lets
 * Analytics, Explainable AI and Prediction history describe the same review.
 *
 * Falls back to the response snapshot when history is unreachable; it never
 * invents a record and never writes to prediction history.
 */
export async function adoptSavedAnalysis(analysis, { entryId = null, source = 'analyzer' } = {}) {
  if (!analysis) return false;
  try {
    const rows = await api.history();
    const text = analysis.text ?? '';
    const match = (Array.isArray(rows) ? [...rows].reverse() : []).find((r) => (
      r.analyzedAt === analysis.analyzedAt
      && (r.prediction ?? null) === (analysis.prediction ?? null)
      && (!text || r.text === text.slice(0, 200))
    ));
    if (match && saveSelection(selectionFromHistory(match))) return true;
  } catch { /* history unreachable — keep the response snapshot */ }

  return saveSelection(selectionFromAnalysis(analysis, {
    source,
    id: entryId ? `analysis:${entryId}:${analysis.analyzedAt || ''}` : undefined
  }));
}
