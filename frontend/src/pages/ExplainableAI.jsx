import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useFetch } from '../hooks/useModels.js';
import {
  loadSelection, saveSelection, clearSelection,
  selectionFromAnalysis, selectionFromHistory
} from '../lib/evidenceStore.js';
import Banner from '../components/ui/Banner.jsx';
import StateBlock from '../components/ui/StateBlock.jsx';
import ProbBars from '../components/charts/ProbBars.jsx';
import PipelineDiagram from '../components/PipelineDiagram.jsx';

/* Reference cards: what each FIELD means (methodology, not per-review data). */
const MODEL_OUTPUTS = [
  { t: 'Class Label', d: 'Fake or Genuine — the binary classifier applies the saved decision threshold to the stacking meta-model probability. There is no trained Suspicious class.' },
  { t: 'Class Probabilities', d: 'P(fake) and P(genuine) come straight from the meta-model and are complementary (they sum to ~100%). The API carries exactly these two keys.' },
  { t: 'Confidence', d: 'The meta-model probability of the predicted class — e.g. 0.89 confidence for a Genuine verdict means the model assigned 89% probability to Genuine.' }
];

const DERIVED = [
  { t: 'Trust Score', d: 'Derived presentation value: 100 − round(P(fake) × 100). It restates the model probability on a 0–100 scale — it is not a separately trained or calibrated output.' },
  { t: 'Risk Level', d: 'Derived label mapping: Fake → high, Genuine → low. It exists for quick reading and adds no information beyond the verdict itself.' },
  { t: 'Why clearly tagged', d: 'Every field here is tagged model, derived or measured so probability, confidence, trust and text signals are never mistaken for one another.' }
];

const MEASURED = [
  { t: 'Model input features', d: 'The 9 handcrafted features the trained pipeline actually consumes (length, repetition, VADER sentiment, promo score, rating-sentiment gap, word length, short flag, reference similarity) are reported verbatim in Measured evidence above.' },
  { t: 'Promotional terms', d: 'Words matched against the PROMO_KEYWORDS list that feeds promo_score. Flagging a phrase is a measurement of wording — not evidence of fraud.' },
  { t: 'Term-ablation attribution', d: 'Each candidate term is deleted from the review and the full pipeline re-runs; the change in P(fake) is reported. It is a perturbation measurement, not SHAP or LIME.' }
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmtVal = (v, unit) => {
  if (!isNum(v)) return String(v);
  const shown = Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
  return unit && unit !== '0 or 1' ? `${shown} ${unit}` : shown;
};

export default function ExplainableAI() {
  const navigate = useNavigate();
  const [selection, setSelection] = useState(() => loadSelection());
  const { data: history, loading, error, reload } = useFetch(() => api.history());

  const evidence = selection?.analysis?.evidence ?? null;
  const a = selection?.analysis ?? null;

  const selectRecord = (rec) => {
    const sel = selectionFromHistory(rec);
    if (sel && saveSelection(sel)) setSelection(sel);
  };

  const openAnalysis = (analysis, id) => {
    const sel = selectionFromAnalysis(analysis, { source: 'analyzer', id });
    if (sel && saveSelection(sel)) setSelection(sel);
  };

  const selectLatest = () => {
    const rows = history || [];
    const latest = [...rows].reverse().find((r) => r.evidence) || rows[rows.length - 1];
    if (latest) selectRecord(latest);
  };

  const doClear = () => { clearSelection(); setSelection(null); };

  const reviewText = evidence?.reviewText ?? a?.text ?? null;
  const selectedRecordId = selection?.source === 'history' ? selection.id.replace(/^history:/, '') : null;

  return (
    <div className="page">
      <div className="page-header enter">
        <h1>Explainable AI</h1>
        <p>
          The evidence for <b>this exact review</b> — model outputs, derived indicators and measured text
          signals, kept strictly separated. Nothing on this page is a sample or a placeholder.
        </p>
      </div>

      {/* ── A. Selected review ─────────────────────────────────────────── */}
      <div className="card enter enter-1" style={{ marginBottom: 22 }}>
        <div className="spread">
          <div>
            <div className="card-title">Selected review</div>
            <div className="card-sub">
              {selection
                ? <>Source: <b>{selection.source}</b> · saved {selection.savedAt ? new Date(selection.savedAt).toLocaleString() : '—'}{a?.entryRef ? <> · entry <b>{a.entryRef}</b></> : null}</>
                : 'No review selected yet.'}
            </div>
          </div>
          {selection && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={doClear}>Clear selection</button>
          )}
        </div>

        {!selection && (
          <StateBlock
            kind="info"
            title="No review selected yet"
            action={
              <div style={{ display: 'flex', gap: 10, marginTop: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/analyzer')}>
                  Open Review Analyzer
                </button>
                {history && history.length > 0 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={selectLatest}>
                    Open most recent analysis
                  </button>
                )}
              </div>
            }
          >
            Analyze a review in the Review Analyzer — the result you analyze is selected automatically
            here — or pick any record from your prediction history below. This page never invents a
            sample result to display.
          </StateBlock>
        )}

        {selection && (
          <>
            <div className="xai-meta">
              {a.productName && <span className="chip strong">{a.productName}</span>}
              <span className="chip cat">{a.productCategory || 'Uncategorized'}</span>
              <span className="chip">{'★'.repeat(a.rating)}{'☆'.repeat(Math.max(0, 5 - a.rating))}</span>
              {a.analyzedAt && <span className="chip faint-chip">{a.analyzedAt}</span>}
              {a.batchId && <span className="chip faint-chip">batch {a.batchId}</span>}
              <span className={`badge badge-${a.prediction || 'neutral'}`}>{a.prediction || 'no prediction'}</span>
            </div>

            <blockquote className="review-quote">{reviewText}</blockquote>

            {a.prediction && a.probabilities ? (
              <div className="grid grid-3" style={{ marginTop: 14 }}>
                <div className="verdict-tile">
                  <div className="vk">Prediction <span className="tag-model">model</span></div>
                  <div className={`prediction-label small-label ${a.prediction}`}>{a.prediction.toUpperCase()}</div>
                </div>
                <div className="verdict-tile">
                  <div className="vk">Probabilities <span className="tag-model">model</span></div>
                  <div style={{ marginTop: 6 }}><ProbBars probabilities={a.probabilities} /></div>
                </div>
                <div className="verdict-tile">
                  <div className="vk">Confidence <span className="tag-model">model</span></div>
                  <div className="vv">{a.confidence != null ? `${(a.confidence * 100).toFixed(1)}%` : '—'}</div>
                  <div className="vk" style={{ marginTop: 10 }}>Trust score <span className="tag-derived">derived</span></div>
                  <div className="vv">{a.trustScore != null ? `${a.trustScore}/100` : '—'}</div>
                  <div className="vk" style={{ marginTop: 10 }}>Risk level <span className="tag-derived">derived</span></div>
                  <div className="vv">{a.riskLevel || '—'}</div>
                </div>
              </div>
            ) : (
              <StateBlock kind="warn" title="No model output stored for this selection">
                {a.status === 'history_no_evidence'
                  ? 'This record has a verdict but no saved evidence object.'
                  : 'This selection carries no prediction.'}
              </StateBlock>
            )}

            {!evidence && a.prediction && (
              <Banner kind="info" style={{ marginTop: 14 }}>
                <b>No saved evidence for this record.</b> It was analyzed before the evidence pipeline was
                connected, so only the prediction fields were stored. Re-run it in the{' '}
                <Link to="/analyzer" style={{ textDecoration: 'underline' }}>Review Analyzer</Link> to
                generate full evidence — nothing is reconstructed or guessed for old records.
              </Banner>
            )}
          </>
        )}
      </div>

      {/* ── B. Measured evidence ───────────────────────────────────────── */}
      {selection && evidence && (
        <>
          <div className="section-head enter enter-2">
            <h2>Measured evidence <span className="badge badge-neutral">rule-based</span></h2>
            <span className="hint">computed by the model's own feature pipeline for this review</span>
          </div>

          <div className="card enter enter-2" style={{ marginBottom: 22 }}>
            <div className="card-title">Detected promotional &amp; repeated terms</div>
            <div className="card-sub">
              Terms that match implemented, documented signals (promo_score keywords and word repetition).
              Detection is a measurement of wording — never proof of deception.
            </div>
            {evidence.suspiciousWords.length > 0 ? (
              <div className="xai-chips">
                {evidence.suspiciousWords.map((w) => (
                  <span className="xai-chip" key={w.word} title={w.reason}>
                    {w.word} <b>×{w.count}</b>
                  </span>
                ))}
              </div>
            ) : (
              <p className="small muted">
                No promotional keywords and no repeated words were found in this review
                (promo_score = 0, repetition_ratio = {isNum(a.probabilities?.fake) ? '' : ''}computed on
                this text). Nothing is flagged when no signal matches.
              </p>
            )}
          </div>

          <div className="card enter enter-2" style={{ marginBottom: 22 }}>
            <div className="card-title">Signal measurements</div>
            <div className="card-sub">
              Every feature the trained pipeline consumed for this exact text, with its value and what it
              measures. Signals that are undefined for this text are marked <b>unavailable</b> with a
              reason — never replaced by a number.
            </div>
            <div className="signal-grid">
              {evidence.measuredSignals.map((s) => (
                <div className={`signal-card${s.available ? '' : ' signal-unavailable'}`} key={s.key}>
                  <div className="signal-head">
                    <span className="signal-label">{s.label}</span>
                    <span className="signal-tag">measured</span>
                  </div>
                  <div className="signal-value">
                    {s.available ? fmtVal(s.value, s.unit) : <span className="unavail-word">unavailable</span>}
                  </div>
                  <p className="signal-desc">{s.description}</p>
                  {!s.available && <p className="signal-reason">{s.unavailableReason}</p>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Model-specific attribution ─────────────────────────────────── */}
      {selection && evidence && (
        <div className="card enter enter-3" style={{ marginBottom: 22 }}>
          <div className="card-title">Model-specific attribution <span className="tag-model">model</span></div>
          <div className="card-sub">
            Perturbation analysis on the trained ensemble: each term below was removed from this review and
            the full pipeline re-run.
          </div>
          {evidence.attribution.status === 'available' ? (
            <>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="attr-table">
                  <thead>
                    <tr>
                      <th>Term removed</th>
                      <th>P(fake) original</th>
                      <th>P(fake) without term</th>
                      <th>Δ P(fake)</th>
                      <th>Verdict effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.attribution.terms.map((t) => (
                      <tr key={t.term}>
                        <td className="mono">“{t.term}”</td>
                        <td className="mono">{t.pFakeOriginal.toFixed(4)}</td>
                        <td className="mono">{t.pFakeWithoutTerm.toFixed(4)}</td>
                        <td className={`mono ${t.deltaFakeProbability > 0 ? 'delta-pos' : t.deltaFakeProbability < 0 ? 'delta-neg' : ''}`}>
                          {t.deltaFakeProbability >= 0 ? '+' : ''}{t.deltaFakeProbability.toFixed(4)}
                        </td>
                        <td>
                          {t.wouldChangeLabel
                            ? <span className="badge badge-neutral">flips to {t.labelWithoutTerm.toUpperCase()}</span>
                            : <span className="faint small">no change</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Array.isArray(evidence.attribution.partialFailures) && evidence.attribution.partialFailures.length > 0 && (
                <p className="small muted" style={{ marginTop: 8 }}>
                  Some terms could not be evaluated: {evidence.attribution.partialFailures.join('; ')}.
                </p>
              )}
              <p className="faint small" style={{ marginTop: 10 }}>{evidence.attribution.description}</p>
            </>
          ) : (
            <Banner kind="info" style={{ marginTop: 10 }}>
              <b>Attribution unavailable for this review:</b> {evidence.attribution.unavailableReason} No
              substitute numbers are shown in its place.
            </Banner>
          )}
        </div>
      )}

      {/* ── C. Explanation summary ─────────────────────────────────────── */}
      {selection && evidence && (
        <div className="card enter enter-3" style={{ marginBottom: 22 }}>
          <div className="card-title">Explanation summary</div>
          <div className="card-sub">Generated from the evidence actually returned for this review.</div>
          <p className="summary-text">{evidence.explanationSummary}</p>
          <div className="xai-label" style={{ marginTop: 14 }}>What this explanation cannot establish</div>
          <ul className="limitations">
            {evidence.limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      {/* ── History selector ───────────────────────────────────────────── */}
      <div className="section-head enter enter-3">
        <h2>Select from history</h2>
        <span className="hint">each row opens the evidence saved with that exact record</span>
      </div>
      <div className="card enter enter-3" style={{ marginBottom: 22 }}>
        {loading && <p className="small muted">Loading prediction history…</p>}
        {error && (
          <StateBlock kind="error" title="Could not load history"
            action={<button type="button" className="btn btn-primary btn-sm" onClick={reload}>Retry</button>}>
            {error.message}
          </StateBlock>
        )}
        {!loading && !error && (!history || history.length === 0) && (
          <StateBlock
            kind="info"
            title="No analyses yet"
            action={
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/analyzer')}>
                  Open Review Analyzer
                </button>
              </div>
            }
          >
            Once you analyze a review it appears here, together with its saved evidence.
          </StateBlock>
        )}
        {!loading && !error && history && history.length > 0 && (
          <div className="sel-list">
            {[...history].reverse().map((rec) => (
              <button
                type="button"
                key={rec.id}
                className={`sel-row${selectedRecordId === rec.id ? ' active' : ''}`}
                onClick={() => selectRecord(rec)}
              >
                <span className={`badge badge-${rec.prediction || 'neutral'}`}>{rec.prediction || '—'}</span>
                <span className="sel-text" title={rec.evidence?.reviewText || rec.text}>
                  {rec.evidence?.reviewText || rec.text}
                </span>
                <span className="sel-meta">
                  {rec.rating}★ · {rec.productCategory || 'Uncategorized'} · {rec.analyzedAt}
                </span>
                <span className={`sel-evi${rec.evidence ? ' yes' : ''}`}>
                  {rec.evidence ? 'evidence saved' : 'no saved evidence'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── D. Transparency: field reference + pipeline ─────────────────── */}
      <div className="section-head enter enter-3">
        <h2>How to read this page</h2>
        <span className="hint">model outputs · derived indicators · measured signals</span>
      </div>
      <div className="card enter enter-3" style={{ marginBottom: 22 }}>
        <div className="card-title">Decision pipeline</div>
        <div className="card-sub">Architecture of the original ML system this application is built around.</div>
        <PipelineDiagram />
      </div>

      <div className="grid grid-3 enter enter-3" style={{ marginBottom: 18 }}>
        {MODEL_OUTPUTS.map((x) => (
          <div className="card hoverable lit" key={x.t}>
            <div className="card-title">{x.t} <span className="tag-model">model</span></div>
            <p className="small muted">{x.d}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-3 enter enter-3" style={{ marginBottom: 18 }}>
        {DERIVED.map((x) => (
          <div className="card hoverable lit" key={x.t}>
            <div className="card-title">{x.t} <span className="tag-derived">derived</span></div>
            <p className="small muted">{x.d}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-3 enter enter-3" style={{ marginBottom: 18 }}>
        {MEASURED.map((x) => (
          <div className="card hoverable lit" key={x.t}>
            <div className="card-title">{x.t} <span className="badge badge-neutral">rule-based</span></div>
            <p className="small muted">{x.d}</p>
          </div>
        ))}
      </div>

      <Banner kind="info">
        Want to measure these signals on another review? Run it through the{' '}
        <Link to="/analyzer" style={{ textDecoration: 'underline' }}>Review Analyzer</Link> — its result
        becomes the selected evidence here automatically.
      </Banner>
    </div>
  );
}
