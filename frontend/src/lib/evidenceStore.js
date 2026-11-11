/**
 * Selection persistence for the Explainable AI page.
 *
 * Stores exactly ONE analysis snapshot (prediction + its validated evidence
 * object) in localStorage so the page can:
 *   - show the most recently analyzed review by default,
 *   - open the correct evidence for any result (single, batch, history),
 *   - restore the SAME selection after a refresh (never a different review),
 *   - discard corrupt or mismatched snapshots instead of rendering them.
 *
 * The evidence object itself is produced by the Python inference service and
 * schema-validated by Express; this module re-validates structurally on read
 * because localStorage can be edited or truncated between sessions.
 */

const KEY = 'afrd.xai.selection.v1';
/** Set when the user clears the workspace, so a re-visit does not silently
 *  re-adopt the newest record against their intent. */
const DISMISSED_KEY = 'afrd.xai.dismissed.v1';

/** Broadcast so every mounted page reading this store stays on one record. */
export const SELECTION_EVENT = 'afrd:selection-change';

function announce(selection) {
  try {
    window.dispatchEvent(new CustomEvent(SELECTION_EVENT, { detail: selection }));
  } catch { /* non-browser environment */ }
}

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

const CATEGORIES = new Set(['model', 'measured', 'attribution']);

/** Structural validation of an evidence object. Returns null when valid,
 *  or a problem string. Mirrors the server-side contract rules. */
export function validateEvidenceShape(ev) {
  if (!isObj(ev)) return 'evidence is not an object';
  if (!nonEmpty(ev.reviewText)) return 'evidence.reviewText missing';
  if (typeof ev.threshold !== 'number' || ev.threshold < 0 || ev.threshold > 1) return 'evidence.threshold invalid';
  if (!Array.isArray(ev.topEvidence) || ev.topEvidence.length < 1) return 'topEvidence empty';
  for (const it of ev.topEvidence) {
    if (!isObj(it) || !nonEmpty(it.label) || !nonEmpty(it.detail) || !CATEGORIES.has(it.category)) {
      return 'topEvidence item malformed';
    }
  }
  if (!Array.isArray(ev.suspiciousWords)) return 'suspiciousWords not an array';
  for (const w of ev.suspiciousWords) {
    if (!isObj(w) || !nonEmpty(w.word) || !(typeof w.count === 'number' && w.count >= 1) || !nonEmpty(w.reason)) {
      return 'suspiciousWords item malformed';
    }
  }
  if (!Array.isArray(ev.measuredSignals) || ev.measuredSignals.length < 1) return 'measuredSignals empty';
  for (const s of ev.measuredSignals) {
    if (!isObj(s) || !nonEmpty(s.key) || !nonEmpty(s.label) || !nonEmpty(s.description)) return 'measured signal malformed';
    if (typeof s.available !== 'boolean') return 'measured signal availability unknown';
    if (s.available && s.value == null) return 'available signal without value';
    if (!s.available && !nonEmpty(s.unavailableReason)) return 'unavailable signal without reason';
  }
  if (!nonEmpty(ev.explanationSummary)) return 'explanationSummary missing';
  if (!Array.isArray(ev.limitations) || ev.limitations.length < 1 || ev.limitations.some((l) => !nonEmpty(l))) {
    return 'limitations missing';
  }
  const a = ev.attribution;
  if (!isObj(a) || !['available', 'unavailable'].includes(a.status) || !nonEmpty(a.description)) {
    return 'attribution malformed';
  }
  if (a.status === 'unavailable' && !nonEmpty(a.unavailableReason)) return 'unavailable attribution without reason';
  return null;
}

/** Full selection validation. Returns null when valid, or a problem string. */
export function validateSelection(sel) {
  if (!isObj(sel)) return 'selection is not an object';
  if (!nonEmpty(sel.id)) return 'selection id missing';
  const a = sel.analysis;
  if (!isObj(a)) return 'analysis snapshot missing';
  if (typeof a.rating !== 'number' || a.rating < 1 || a.rating > 5) return 'rating invalid';
  if (a.evidence != null) {
    const problem = validateEvidenceShape(a.evidence);
    if (problem) return `evidence: ${problem}`;
    // Association guard: the stored review text and the evidence must describe
    // the SAME review. `text` may be a stored excerpt only for legacy records;
    // full texts must match exactly.
    if (nonEmpty(a.text) && a.text !== a.evidence.reviewText && !a.text.startsWith(a.evidence.reviewText.slice(0, 190))) {
      return 'stored text does not match evidence.reviewText (mixed reviews)';
    }
  }
  return null;
}

/** Persist the current selection. Returns true on success. */
export function saveSelection(sel) {
  const problem = validateSelection(sel);
  if (problem) {
    console.warn('[evidenceStore] refused invalid selection:', problem);
    return false;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(sel));
    localStorage.removeItem(DISMISSED_KEY);
    announce(sel);
    return true;
  } catch {
    return false;
  }
}

/** Load the persisted selection, re-validated. Returns null when absent or invalid. */
export function loadSelection() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const sel = JSON.parse(raw);
    if (validateSelection(sel)) return null;
    return sel;
  } catch {
    return null;
  }
}

export function clearSelection() {
  try {
    localStorage.removeItem(KEY);
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch { /* private mode */ }
  announce(null);
}

/** True when the user explicitly cleared the selection in this browser. */
export function isSelectionDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
}

/** Build a selection snapshot from an analysis result (single or batch entry). */
export function selectionFromAnalysis(analysis, { source = 'analyzer', id } = {}) {
  if (!isObj(analysis)) return null;
  const selId = id || `analysis:${analysis.analyzedAt || Date.now()}:${(analysis.text || '').slice(0, 24)}`;
  return {
    id: selId,
    source,
    savedAt: new Date().toISOString(),
    analysis: {
      status: analysis.status,
      text: analysis.evidence?.reviewText ?? analysis.text ?? null,
      productName: analysis.productName ?? null,
      productCategory: analysis.productCategory ?? null,
      rating: Number(analysis.rating),
      prediction: analysis.prediction ?? null,
      probabilities: analysis.probabilities ?? null,
      confidence: analysis.confidence ?? null,
      trustScore: analysis.trustScore ?? null,
      riskLevel: analysis.riskLevel ?? null,
      modelVersion: analysis.model?.version ?? analysis.modelVersion ?? null,
      analyzedAt: analysis.analyzedAt ?? null,
      batchId: analysis.batchId ?? null,
      entryRef: analysis.entryRef ?? null,
      evidence: analysis.evidence ?? null
    }
  };
}

/** Build a selection snapshot from a history record (evidence may be absent
 *  for records predating the evidence pipeline — that is a valid selection
 *  that renders an honest "no saved evidence" state). */
export function selectionFromHistory(record) {
  if (!isObj(record)) return null;
  return {
    id: `history:${record.id}`,
    source: 'history',
    savedAt: new Date().toISOString(),
    analysis: {
      status: record.prediction ? 'model_connected' : 'history_no_evidence',
      text: record.evidence?.reviewText ?? record.text ?? null,
      productName: record.productName ?? null,
      productCategory: record.productCategory ?? null,
      rating: Number(record.rating),
      prediction: record.prediction ?? null,
      probabilities: record.probabilities ?? null,
      confidence: record.confidence ?? null,
      trustScore: record.trustScore ?? null,
      riskLevel: record.riskLevel ?? null,
      modelVersion: record.modelVersion ?? null,
      analyzedAt: record.analyzedAt ?? null,
      batchId: record.batchId ?? null,
      entryRef: record.entryRef ?? null,
      evidence: record.evidence ?? null
    }
  };
}
