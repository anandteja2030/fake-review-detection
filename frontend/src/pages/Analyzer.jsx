import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adoptSavedAnalysis } from '../lib/adoptAnalysis.js';
import { api } from '../api/client.js';
import { useFetch } from '../hooks/useModels.js';
import Banner from '../components/ui/Banner.jsx';
import StateBlock from '../components/ui/StateBlock.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import ProbBars from '../components/charts/ProbBars.jsx';
import RadialMeter from '../components/charts/RadialMeter.jsx';
import { IconRefresh, IconArrowRight, IconPlus, IconTrash, IconEdit, IconCheck } from '../components/layout/Icons.jsx';

const RISK_COLORS = { low: 'var(--genuine)', high: 'var(--fake)' };
const TEXT_MAX = 6000;
const MAX_ENTRIES = 70;            // collection limit for one workflow
const CHUNK_CONCURRENCY = 2;       // parallel chunk requests (server bounds inference inside each)
const CHUNK_TIMEOUT_MS = 120000;   // hard per-chunk timeout so a hung call cannot stall the run

let uidSeq = 0;
const newEntry = () => ({
  id: `e${++uidSeq}`,
  productName: '', productCategory: '', rating: null, text: '',
  status: 'pending',   // 'pending' | 'running' | 'completed' | 'failed'
  result: null,        // analysis snapshot returned by the model service
  error: null,         // { code, message } when the last attempt failed
  stale: false         // inputs edited after the result was produced
});

function validateEntry(e) {
  const errs = {};
  if (!e.text.trim()) errs.text = 'Review text is required.';
  if (e.rating === null) errs.rating = 'Pick a star rating for this review.';
  if (!e.productCategory.trim()) errs.productCategory = 'Choose or enter a product category.';
  return errs;
}

const isValid = (e) => Object.keys(validateEntry(e)).length === 0;
const isAnalyzable = (e) => e.status === 'pending' || e.status === 'failed' || (e.status === 'completed' && e.stale);

export default function Analyzer({ modelStatus }) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState(() => [newEntry(), newEntry(), newEntry()]);
  const [entryErrors, setEntryErrors] = useState({});
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(null);  // { done, total }
  const [runSummary, setRunSummary] = useState(null);    // aggregate of the latest run
  const [requestError, setRequestError] = useState(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const entriesRef = useRef(entries);
  const resultsRef = useRef(null);
  const { data: catData } = useFetch(() => api.categories());
  const { data: sampleData } = useFetch(() => api.samples());
  const maxBatch = catData?.maxBatch ?? 10;

  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const counts = useMemo(() => {
    const c = { total: entries.length, completed: 0, pending: 0, failed: 0, running: 0, stale: 0 };
    for (const e of entries) {
      if (e.status === 'running') c.running += 1;
      else if (e.status === 'failed') c.failed += 1;
      else if (e.status === 'completed') { c.completed += 1; if (e.stale) c.stale += 1; }
      else c.pending += 1;
    }
    return c;
  }, [entries]);

  const allTargets = useMemo(() => entries.filter((e) => isAnalyzable(e) && isValid(e)), [entries]);
  const remainingTargets = useMemo(
    () => entries.filter((e) => (e.status === 'pending' || (e.status === 'completed' && e.stale)) && isValid(e)),
    [entries]
  );
  const failedTargets = useMemo(() => entries.filter((e) => e.status === 'failed' && isValid(e)), [entries]);

  const applyPatches = useCallback((patches) => {
    if (!patches.size) return;
    setEntries((prev) => prev.map((e) => (patches.has(e.id) ? { ...e, ...patches.get(e.id) } : e)));
  }, []);

  const update = useCallback((id, patch) => {
    setEntries((prev) => prev.map((e) => {
      if (e.id !== id) return e;
      const next = { ...e, ...patch };
      const touchesInputs = 'text' in patch || 'rating' in patch || 'productCategory' in patch || 'productName' in patch;
      if (touchesInputs && e.status === 'completed') next.stale = true;
      return next;
    }));
    setEntryErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const addAnother = useCallback(() => {
    if (entriesRef.current.length >= MAX_ENTRIES) return;
    const created = newEntry();
    setEntries((prev) => (prev.length >= MAX_ENTRIES ? prev : [...prev, created]));
    setEntryErrors({});
    requestAnimationFrame(() => {
      const el = document.getElementById(`entry-${created.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const ta = el.querySelector('textarea');
        if (ta) setTimeout(() => ta.focus(), 350);
      }
    });
  }, []);

  const removeEntry = useCallback((id) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      return next.length ? next : [newEntry()];
    });
    setEntryErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const clearPending = useCallback(() => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.status !== 'pending');
      return next.length ? next : [newEntry()];
    });
    setEntryErrors({});
    setClearConfirm(false);
  }, []);

  const focusEntry = useCallback((id) => {
    const el = document.getElementById(`entry-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const ta = el.querySelector('textarea');
      if (ta) setTimeout(() => ta.focus(), 350);
    }
  }, []);

  /** Chunked, bounded-concurrency run over the given entry ids. */
  const runEntries = useCallback(async (ids) => {
    if (!ids.length || entriesRef.current.some((e) => e.status === 'running')) return;
    const targets = entriesRef.current.filter((e) => ids.includes(e.id));
    const errs = {};
    const toRun = [];
    for (const e of targets) {
      const v = validateEntry(e);
      if (Object.keys(v).length) errs[e.id] = v;
      else toRun.push(e);
    }
    setEntryErrors(errs);
    setRequestError(null);
    if (!toRun.length) return;

    setRunning(true);
    setRunSummary(null);
    setRunProgress({ done: 0, total: toRun.length });
    applyPatches(new Map(toRun.map((e) => [e.id, { status: 'running', error: null, result: null }])));

    const chunkSize = Math.max(1, Math.min(Number(maxBatch) || 10, 20));
    const chunks = [];
    for (let i = 0; i < toRun.length; i += chunkSize) chunks.push(toRun.slice(i, i + chunkSize));

    const agg = { submitted: 0, completed: 0, predicted: 0, fake: 0, genuine: 0, failed: 0, invalid: 0, batches: [] };
    let cursor = 0;
    let done = 0;
    let lastError = null;
    let latest = null; // last successfully analyzed entry (becomes the XAI selection)

    const applyChunk = (chunk, data) => {
      const patches = new Map();
      const results = Array.isArray(data.results) ? data.results : [];
      for (const r of results) {
        const e = chunk.find((x) => x.id === r.ref);
        if (!e) continue;
        if (r.status === 'completed' && r.analysis) {
          patches.set(e.id, { status: 'completed', result: r.analysis, error: null, stale: false });
          latest = { id: e.id, analysis: r.analysis };
        } else if (r.status === 'failed') {
          patches.set(e.id, { status: 'failed', result: null, error: r.error || { code: 'SERVER_ERROR', message: 'Analysis failed.' } });
        } else if (r.status === 'invalid') {
          patches.set(e.id, { status: 'failed', result: null, error: { code: 'INVALID_ENTRY', message: (r.errors || []).join(' · ') || 'Entry rejected by validation.' } });
        } else {
          patches.set(e.id, { status: 'failed', result: null, error: { code: 'BAD_RESPONSE', message: 'Unrecognized result status from the service.' } });
        }
      }
      for (const e of chunk) {
        if (!patches.has(e.id)) {
          patches.set(e.id, { status: 'failed', result: null, error: { code: 'NO_RESULT', message: 'The service returned no result for this review.' } });
        }
      }
      applyPatches(patches);
      const s = data.summary || {};
      agg.submitted += s.submitted ?? chunk.length;
      agg.completed += s.completed ?? 0;
      agg.predicted += s.predicted ?? 0;
      agg.fake += s.fake ?? 0;
      agg.genuine += s.genuine ?? 0;
      agg.failed += s.failed ?? 0;
      agg.invalid += s.invalid ?? 0;
      if (data.batchId) agg.batches.push(data.batchId);
    };

    const applyChunkFailure = (chunk, err) => {
      applyPatches(new Map(chunk.map((e) => [e.id, {
        status: 'failed', result: null,
        error: { code: err.code || 'NETWORK_ERROR', message: err.message }
      }])));
      lastError = err;
    };

    const worker = async () => {
      while (cursor < chunks.length) {
        const chunk = chunks[cursor++];
        const payload = chunk.map((e) => ({
          ref: e.id,
          text: e.text.trim(),
          rating: e.rating,
          productName: e.productName.trim() || undefined,
          productCategory: e.productCategory.trim()
        }));
        try {
          const data = await api.analyzeBatch(payload, { timeoutMs: CHUNK_TIMEOUT_MS });
          applyChunk(chunk, data);
        } catch (err) {
          applyChunkFailure(chunk, err);
        }
        done += chunk.length;
        setRunProgress({ done, total: toRun.length });
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker));
      setRunSummary({ ...agg });
      if (agg.submitted > 0 && agg.predicted === 0 && agg.completed === 0 && lastError) {
        setRequestError(lastError);
      }
      // Most recent successful analysis becomes the shared current-analysis
      // record. Re-reading history here binds the selection to the RECORD the
      // server just stored, so Analytics and Explainable AI reference the same
      // id instead of a stale snapshot.
      if (latest?.analysis) {
        await adoptSavedAnalysis(latest.analysis, { entryId: latest.id, source: 'analyzer' });
      }
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } finally {
      setRunning(false);
      setRunProgress(null);
    }
  }, [applyPatches, maxBatch]);

  /** Select this result's evidence on the Explainable AI page, then open it. */
  const openEvidence = async (entry) => {
    if (!entry?.result) return;
    await adoptSavedAnalysis(entry.result, { entryId: entry.id, source: 'analyzer' });
    navigate('/explainability');
  };

  function loadSample(s) {
    setEntries((prev) => {
      const idx = prev.findIndex((en) => !en.text.trim() && en.status === 'pending');
      if (idx === -1) {
        if (prev.length >= MAX_ENTRIES) return prev;
        const fresh = newEntry();
        return [...prev, { ...fresh, text: s.text, rating: s.rating }];
      }
      return prev.map((en, i) => (i === idx ? { ...en, text: s.text, rating: s.rating } : en));
    });
    setEntryErrors({});
  }

  const resultEntries = entries.filter((e) => e.status === 'completed' || e.status === 'failed');
  const atLimit = entries.length >= MAX_ENTRIES;

  return (
    <div className="page">
      <PageHeader
        index="02"
        eyebrow="Analysis workspace"
        title={<>Review <span className="grad-text">Analyzer</span></>}
        description={<>Build a collection of <b>30–70 reviews</b> in one workflow. Each review keeps its own text,
          star rating, product category and product name — the stacking-ensemble model classifies each as
          <b> Fake</b> or <b>Genuine</b> independently, and every result stays pinned to the review that produced it.</>}
        meta={[
          { k: 'Entries', v: entries.length },
          { k: 'Batch cap', v: maxBatch },
          { k: 'Completed', v: counts.completed, tone: counts.completed ? 'genuine' : undefined },
          { k: 'Model', v: modelStatus ? (modelStatus.connected ? 'Online' : 'Offline') : '…', tone: modelStatus?.connected ? 'genuine' : undefined }
        ]}
        actions={
          <button type="button" className="btn btn-secondary btn-sm" onClick={addAnother} disabled={running || atLimit}>
            <IconPlus width="14" height="14" /> Add review
          </button>
        }
      />

      {modelStatus && !modelStatus.connected && (
        <div style={{ marginBottom: 18 }}>
          <Banner kind="warn">
            <b>ML model not connected.</b> No prediction, probability, trust score, or risk level will be produced.
            Displayed features are deterministic heuristic measurements — <b>not</b> model output.
          </Banner>
        </div>
      )}

      <form className="card console-panel enter enter-1" onSubmit={(e) => { e.preventDefault(); runEntries(allTargets.map((x) => x.id)); }}>
        <span className="console-rail" aria-hidden="true" />
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="card-title">Review collection</div>
            <div className="card-sub">
              One review per panel. Analyze one at a time with <b>Analyze Review</b>, or run the whole
              collection with <b>Analyze All</b> — requests are split into safe chunks automatically.
            </div>
          </div>
          <span className="chip cat small-chip">{counts.total} / {MAX_ENTRIES} collected</span>
        </div>

        <div className="counters-row" aria-live="polite">
          <Counter k="Added" v={counts.total} note={`of ${MAX_ENTRIES} max`} />
          <Counter k="Completed" v={counts.completed} tone="genuine" note={counts.stale ? `${counts.stale} edited` : 'analyzed'} />
          <Counter k="Pending" v={counts.pending} tone="amber" note="waiting for analysis" />
          <Counter k="Failed" v={counts.failed} tone={counts.failed ? 'fake' : undefined} note={counts.failed ? 'retry available' : 'none'} />
          {counts.running > 0 && <Counter k="Running" v={counts.running} tone="accent" note="in flight" />}
        </div>

        <div className="entry-list">
          {entries.map((en, i) => (
            <EntryPanel
              key={en.id} entry={en} index={i} errors={entryErrors[en.id] || {}}
              categories={catData?.categories || []}
              disabled={running}
              atLimit={atLimit}
              onChange={(patch) => update(en.id, patch)}
              onRemove={() => removeEntry(en.id)}
              onEdit={() => focusEntry(en.id)}
              onAnalyze={() => runEntries([en.id])}
            />
          ))}
        </div>

        <div className="row wrap" style={{ marginTop: 14, gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={addAnother} disabled={running || atLimit}>
            <IconPlus width="15" height="15" /> Add Another Review
          </button>
          <button type="button" className="btn btn-ghost danger" disabled={running || counts.pending === 0}
            onClick={() => (clearConfirm ? clearPending() : setClearConfirm(true))} onBlur={() => setClearConfirm(false)}>
            <IconTrash width="15" height="15" /> {clearConfirm ? 'Confirm clear pending?' : 'Clear Pending Reviews'}
          </button>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" disabled={running || remainingTargets.length === 0}
            onClick={() => runEntries(remainingTargets.map((x) => x.id))}>
            Analyze Remaining{remainingTargets.length > 0 && ` (${remainingTargets.length})`}
          </button>
          <button type="button" className="btn btn-ghost" disabled={running || failedTargets.length === 0}
            onClick={() => runEntries(failedTargets.map((x) => x.id))}>
            <IconRefresh width="14" height="14" /> Retry Failed{failedTargets.length > 0 && ` (${failedTargets.length})`}
          </button>
          <button type="submit" className="btn btn-primary" disabled={running || allTargets.length === 0}>
            {running
              ? <>Analyzing {runProgress ? `${runProgress.done}/${runProgress.total}` : '…'}<IconArrowRight width="16" height="16" /></>
              : <>Analyze All{allTargets.length > 0 && ` (${allTargets.length})`} <IconArrowRight width="16" height="16" /></>}
          </button>
        </div>

        {atLimit && !running && (
          <div className="banner banner-warn" style={{ marginTop: 12 }}>
            Collection limit reached: <b>{MAX_ENTRIES} reviews</b>. Remove a review to add another.
          </div>
        )}
        {Object.keys(entryErrors).length > 0 && !running && (
          <div className="banner banner-error" style={{ marginTop: 12 }}>
            <b>{Object.keys(entryErrors).length} entr{Object.keys(entryErrors).length === 1 ? 'y needs' : 'ies need'} attention.</b>{' '}
            Fix the highlighted fields — valid entries are still analyzed if you press the analyze buttons again.
          </div>
        )}
        {requestError && (
          <div className="banner banner-error" style={{ marginTop: 12 }}>
            <b>Batch request failed:</b> {requestError.message} — successful results from other chunks were preserved.
          </div>
        )}

        {sampleData?.samples?.length > 0 && (
          <div className="samples-row">
            <span className="faint small">Try a sample:</span>
            {sampleData.samples.map((s) => (
              <button type="button" key={s.id} className="sample-chip" onClick={() => loadSample(s)}>{s.label}</button>
            ))}
            <span className="faint small">— fills the next empty pending entry</span>
          </div>
        )}
      </form>

      <div ref={resultsRef}>
        {running && (
          <div className="card enter enter-2" style={{ marginTop: 18 }}>
            <div className="card-title">
              Analyzing {runProgress ? `${runProgress.done}/${runProgress.total}` : ''} review{runProgress?.total === 1 ? '' : 's'}
            </div>
            <div className="card-sub">
              Processing in chunks of up to {maxBatch} with bounded concurrency — successful results are kept
              even if a later chunk fails. The model classifies each review independently through the hybrid
              feature pipeline and stacking ensemble.
            </div>
            <div className="scan-frame">
              <span className="scan-line" />
              <span className="scan-label">
                <span className="scan-core" aria-hidden="true" />
                tf-idf · manual features · sbert · meta-model
                <span className="scan-steps" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /></span>
              </span>
            </div>
            <div style={{ marginTop: 16, display: 'grid', placeItems: 'center' }}>
              <div className="spinner" />
            </div>
          </div>
        )}

        {!running && runSummary && (
          <div style={{ marginTop: 18 }}>
            <RunSummary summary={runSummary} />
          </div>
        )}

        {!running && !resultEntries.length && !runSummary && (
          <div className="card" style={{ marginTop: 18 }}>
            <StateBlock kind="info" title="No reviews analyzed yet">
              Fill each review panel with its own text, star rating, and product category, then press{' '}
              <b>Analyze Review</b> on a single entry or <b>Analyze All</b> for the whole collection.
              Results appear here with the full metadata preserved.
            </StateBlock>
          </div>
        )}

        {resultEntries.length > 0 && !running && (
          <div className="enter enter-2" style={{ marginTop: 18, display: 'grid', gap: 14 }}>
            {resultEntries.map((e) => (
              <EntryResultCard key={e.id} entry={e} index={entries.indexOf(e)}
                onRetry={() => runEntries([e.id])} onEdit={() => focusEntry(e.id)}
                onEvidence={() => openEvidence(e)} />
            ))}
          </div>
        )}

        {!running && (counts.completed > 0 || counts.failed > 0) && (
          <div className="add-another-wrap">
            <button type="button" className="btn btn-primary add-another-cta" onClick={addAnother} disabled={atLimit}>
              <IconPlus width="18" height="18" /> Add Another Review
            </button>
            <span className="faint small">
              {atLimit
                ? `Collection is full (${MAX_ENTRIES} reviews).`
                : `Opens a fresh entry above — your ${counts.completed} completed result${counts.completed === 1 ? '' : 's'} stay right here.`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Counter({ k, v, note, tone }) {
  return (
    <div className={`counter-pill${tone ? ` tone-${tone}` : ''}`}>
      <span className="cp-v">{v}</span>
      <span className="cp-k">{k}</span>
      {note ? <span className="cp-n">{note}</span> : null}
    </div>
  );
}

function EntryPanel({ entry, index, errors, categories, disabled, atLimit, onChange, onRemove, onEdit, onAnalyze }) {
  const stale = entry.status === 'completed' && entry.stale;
  const analyzable = isAnalyzable(entry);
  return (
    <div className={`entry-panel${entry.status === 'completed' && !stale ? ' has-result' : ''}`} id={`entry-${entry.id}`}>
      <div className="spread" style={{ marginBottom: 10 }}>
        <span className="entry-tag">
          Review {String(index + 1).padStart(2, '0')}
          {entry.status === 'running' && <span className="entry-status running">analyzing…</span>}
          {entry.status === 'completed' && entry.result?.prediction && (
            <span className={`entry-status ${entry.result.prediction}`}>{entry.result.prediction}</span>
          )}
          {entry.status === 'completed' && !entry.result?.prediction && <span className="entry-status pending">no model output</span>}
          {stale && <span className="entry-status pending">edited — re-analyze</span>}
          {entry.status === 'failed' && <span className="entry-status failed" title={entry.error?.message}>failed</span>}
          {entry.status === 'pending' && <span className="entry-status pending">pending</span>}
        </span>
        <span className="entry-actions">
          <button type="button" className="icon-btn" onClick={onEdit} disabled={disabled}
            aria-label={`Edit review ${index + 1}`} title="Edit this review">
            <IconEdit width="14" height="14" />
          </button>
          <button type="button" className="icon-btn" onClick={onRemove} disabled={disabled}
            aria-label={`Remove review ${index + 1}`} title="Remove this review">
            <IconTrash width="14" height="14" />
          </button>
        </span>
      </div>

      <div className="entry-grid">
        <div className="entry-field">
          <label className="field-label">Product name <span className="faint">(optional)</span></label>
          <input className="text-input" type="text" placeholder="e.g. Wireless Headphones" maxLength={120}
            value={entry.productName} disabled={disabled}
            onChange={(e) => onChange({ productName: e.target.value })} />
        </div>
        <div className="entry-field">
          <CategoryPicker value={entry.productCategory} categories={categories} disabled={disabled}
            error={errors.productCategory} onChange={(v) => onChange({ productCategory: v })} />
        </div>
        <div className="entry-field rating-field">
          <div className="spread" style={{ marginBottom: 5 }}>
            <label className="field-label">Star rating <span className="req">*</span></label>
            <span className="star-readout">{entry.rating ?? '—'} / 5</span>
          </div>
          <div className="star-picker compact" role="radiogroup" aria-label={`Star rating for review ${index + 1}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} role="radio" aria-checked={entry.rating === n} disabled={disabled}
                aria-label={`${n} star${n > 1 ? 's' : ''}`} data-rating={n}
                className={`star-btn${entry.rating != null && entry.rating >= n ? ' on' : ''}${entry.rating === n ? ' selected' : ''}`}
                onClick={() => onChange({ rating: n })}>
                ★
              </button>
            ))}
          </div>
          {errors.rating && <div className="field-error">{errors.rating}</div>}
        </div>
      </div>

      <div className="entry-field" style={{ marginTop: 10 }}>
        <label className="field-label">Review text <span className="req">*</span></label>
        <textarea className="textarea" placeholder="e.g. Amazing product! Highly recommended…" maxLength={TEXT_MAX}
          value={entry.text} disabled={disabled} onChange={(e) => onChange({ text: e.target.value })} />
        <div className="spread" style={{ marginTop: 4 }}>
          <span className="faint small">{entry.text.length}/{TEXT_MAX} chars · {countWords(entry.text)} words</span>
          {errors.text && <span className="field-error">{errors.text}</span>}
        </div>
      </div>

      {errors.productCategory && (
        <div className="field-error" style={{ marginTop: 6 }}>{errors.productCategory}</div>
      )}

      <div className="entry-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={disabled || !analyzable}
          onClick={onAnalyze} title={analyzable ? 'Run the model on this review' : 'Already analyzed — edit it first'}>
          {entry.status === 'failed' ? 'Retry Review' : analyzable ? 'Analyze Review' : 'Analyzed'}
          {analyzable ? <IconArrowRight width="14" height="14" /> : <IconCheck width="14" height="14" />}
        </button>
        <span className="faint small">
          {entry.status === 'completed' && !stale
            ? 'Result below is current — editing any field re-opens it for analysis.'
            : analyzable
              ? 'Validates this entry only and displays its own result.'
              : 'Add text, rating, and category to analyze.'}
        </span>
        {atLimit && <span className="faint small" style={{ marginLeft: 'auto' }}>limit {MAX_ENTRIES}</span>}
      </div>
    </div>
  );
}

function CategoryPicker({ value, categories, disabled, error, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    const close = (ev) => { if (boxRef.current && !boxRef.current.contains(ev.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const isPreset = categories.includes(value);
  const filtered = categories.filter((c) => c.toLowerCase().includes(query.trim().toLowerCase()));
  const customAllowed = query.trim().length > 0 && !categories.some((c) => c.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className={`cat-picker${error ? ' has-error' : ''}`} ref={boxRef}>
      <label className="field-label">Product category <span className="req">*</span></label>
      <input className="text-input" type="text" role="combobox" aria-expanded={open} aria-autocomplete="list"
        placeholder="Search categories…" disabled={disabled} value={open ? query : value}
        onFocus={() => { setQuery(isPreset || !value ? '' : value); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
      {open && (
        <ul className="cat-menu" role="listbox">
          {filtered.map((c) => (
            <li key={c}>
              <button type="button" role="option" aria-selected={value === c}
                className={`cat-opt${value === c ? ' selected' : ''}`}
                onClick={() => { onChange(c); setOpen(false); }}>
                {c}
              </button>
            </li>
          ))}
          {filtered.length === 0 && !customAllowed && (
            <li className="cat-empty faint small">No matching category — keep typing to use a custom one.</li>
          )}
          {customAllowed && (
            <li>
              <button type="button" className="cat-opt custom" onClick={() => { onChange(query.trim()); setOpen(false); }}>
                Use custom category: “{query.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
      {value && !isPreset && <span className="cat-custom-tag">custom category</span>}
    </div>
  );
}

function RunSummary({ summary }) {
  return (
    <div className="card batch-summary hud-corners">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="card-title">Run Summary</div>
          <div className="card-sub faint small">
            {summary.batches.length ? `batch${summary.batches.length === 1 ? '' : 'es'} ${summary.batches.join(', ')} · ` : ''}
            counts include only actually returned predictions
          </div>
        </div>
        <span className="chip">{summary.completed}/{summary.submitted} completed</span>
      </div>
      <div className="summary-grid">
        <SummaryTile k="Submitted" v={summary.submitted} note="reviews in this run" />
        <SummaryTile k="Completed" v={summary.completed} note="entries that got a response" />
        <SummaryTile k="Predicted Fake" v={summary.fake} note="model output — not a verified truth label" tone="fake" />
        <SummaryTile k="Predicted Genuine" v={summary.genuine} note="model output — not a verified truth label" tone="genuine" />
        <SummaryTile k="Failed" v={summary.failed} note="entry errors — no prediction recorded" tone={summary.failed ? 'fail' : undefined} />
        {summary.invalid > 0 && <SummaryTile k="Invalid" v={summary.invalid} note="blocked by per-entry validation" tone="fail" />}
      </div>
      <p className="faint small" style={{ marginTop: 10 }}>
        Fake/Genuine counts are model outputs — not independently verified truth labels.
        {' '}Successful results are kept even when other entries fail; failed entries never create history records.
      </p>
    </div>
  );
}

function SummaryTile({ k, v, note, tone }) {
  return (
    <div className={`summary-tile${tone ? ` tone-${tone}` : ''}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      <div className="n">{note}</div>
    </div>
  );
}

function EntryResultCard({ entry, index, onRetry, onEdit, onEvidence }) {
  const num = String(index + 1).padStart(2, '0');

  if (entry.status === 'failed') {
    return (
      <div className="card result-card invalid">
        <div className="spread">
          <span className="entry-tag">Review {num}</span>
          <span className="entry-status failed">analysis failed</span>
        </div>
        <p className="small" style={{ marginTop: 8 }}>
          <b>{entry.error?.code || 'ERROR'}</b> — {entry.error?.message || 'Unknown error'}. No prediction was
          recorded for this review, and no history entry was created.
        </p>
        <div className="entry-actions" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
            <IconRefresh width="14" height="14" /> Retry Failed Review
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <IconEdit width="14" height="14" /> Edit Review
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="result-card-wrap">
      {entry.stale && (
        <div className="stale-banner">
          Inputs edited after this result — <b>re-analyze</b> to refresh it. The result below shows what was
          actually analyzed.
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <FullResult analysis={entry.result} entry={entry} index={index} />
        <div className="result-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <IconEdit width="14" height="14" /> Edit Review
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
            <IconRefresh width="14" height="14" /> Re-analyze
          </button>
          {entry.result?.evidence && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEvidence}>
              View evidence
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FullResult({ analysis, entry, index }) {
  const f = analysis.features || {};
  const gap = analysis.ratingSentimentGap || {};
  const modelConnected = analysis.status === 'model_connected';
  const risky = analysis.riskLevel && RISK_COLORS[analysis.riskLevel];
  const num = String(index + 1).padStart(2, '0');

  return (
    <div className="card result-card full hud-corners">
      <div className="result-head">
        <div className="result-id">
          <span className="entry-tag">Review {num}</span>
          {modelConnected
            ? <span className={`prediction-label small-label ${analysis.prediction}`}>{analysis.prediction?.toUpperCase()}</span>
            : <span className="prediction-label small-label pending">NO MODEL OUTPUT</span>}
        </div>
        <div className="result-meta">
          {analysis.productName && <span className="chip strong">{analysis.productName}</span>}
          <span className="chip cat">{analysis.productCategory || 'Uncategorized'}</span>
          <Stars rating={analysis.rating} />
        </div>
      </div>

      <blockquote className="review-quote">{analysis.text}</blockquote>

      {modelConnected ? (
        <>
          <div className={`result-verdict ${analysis.prediction}`}>
            <div>
              <span className="rv-k">Model verdict</span>
              <div className="rv-v">{analysis.prediction === 'fake' ? 'Fake review' : 'Genuine review'}</div>
              <span className="rv-sub">
                {analysis.prediction === 'fake'
                  ? 'Language patterns align with the deceptive-review class.'
                  : 'No strong deceptive-language pattern was detected in this text.'}
              </span>
            </div>
            <div className="rv-probs">
              <RadialMeter
                value={analysis.probabilities ? Number(analysis.probabilities.fake) * 100 : null}
                label="P(fake)"
                color="var(--fake)"
                size={92}
              />
              <RadialMeter
                value={analysis.probabilities
                  ? Number(analysis.probabilities.genuine != null ? analysis.probabilities.genuine : 1 - Number(analysis.probabilities.fake)) * 100
                  : null}
                label="P(genuine)"
                color="var(--genuine)"
                size={92}
              />
            </div>
          </div>
          <div className="verdict-strip">
            <div className="verdict-item">
              <div className="vk">Confidence <span className="tag-model">model</span></div>
              <div className="vv">{analysis.confidence != null ? `${(analysis.confidence * 100).toFixed(1)}%` : '—'}</div>
              <div className="vn">meta-model probability of the predicted class</div>
            </div>
            <div className="verdict-item">
              <div className="vk">Trust Score <span className="tag-derived">derived</span></div>
              <div className="vv">{analysis.trustScore != null ? `${analysis.trustScore}/100` : '—'}</div>
              <div className="vn">100 − P(fake)×100, rounded — not a trained output</div>
            </div>
            <div className="verdict-item">
              <div className="vk">Risk Level <span className="tag-derived">derived</span></div>
              <div className="vv" style={{ color: risky ? RISK_COLORS[analysis.riskLevel] : undefined }}>{analysis.riskLevel ?? '—'}</div>
              <div className="vn">label mapping: fake → high, genuine → low</div>
            </div>
          </div>
          {analysis.probabilities && (
            <div style={{ marginTop: 14 }}><ProbBars probabilities={analysis.probabilities} /></div>
          )}
          <details className="signals-details">
            <summary>Measured signals <span className="faint small">(deterministic text measurements — not model attribution)</span></summary>
            <div className="metric-grid" style={{ marginTop: 10 }}>
              <Tile k="Sentiment" v={f.sentiment?.label ?? '—'} note={`${f.sentiment?.positiveHits ?? 0} pos / ${f.sentiment?.negativeHits ?? 0} neg lexicon hits`} />
              <Tile k="Length" v={`${f.reviewLength?.words ?? 0} words`} note={`${f.reviewLength?.characters ?? 0} chars · ${f.reviewLength?.sentences ?? 0} sentences`} />
              <Tile k="Rating–Sentiment Gap" v={gap.gap ?? '—'} note={gap.aligned === undefined ? '' : gap.aligned ? 'aligned' : 'misaligned'} />
              <Tile k="Promotional Language" v={f.promoHits ?? 0} note="promotional phrases flagged" />
              <Tile k="Flagged Words" v={f.suspiciousWordList?.length ?? 0} note="heuristic word flags" />
              <Tile k="Heuristic Suspicion" v={f.suspicionScore ?? '—'} note="simple flag weighting" />
            </div>
            <p className="faint small" style={{ marginTop: 8 }}>
              No SHAP / LIME attribution is implemented — see <Link to="/explainability">Explainable AI</Link>.
            </p>
          </details>
        </>
      ) : (
        <p className="small muted" style={{ marginTop: 10 }}>{analysis.message}</p>
      )}
    </div>
  );
}

function Stars({ rating }) {
  return (
    <span className="stars-display" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`star${n <= rating ? ' on' : ''}`}>★</span>
      ))}
    </span>
  );
}

function Tile({ k, v, note }) {
  return (
    <div className="metric-tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

function countWords(s) {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}
