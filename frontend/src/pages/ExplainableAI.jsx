import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useFetch } from '../hooks/useModels.js';
import { useSelection } from '../hooks/useSelection.js';
import {
  saveSelection, clearSelection, isSelectionDismissed, selectionFromHistory
} from '../lib/evidenceStore.js';
import Banner from '../components/ui/Banner.jsx';
import StateBlock from '../components/ui/StateBlock.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import PipelineDiagram from '../components/PipelineDiagram.jsx';
import { IconSearch, IconBrain } from '../components/layout/Icons.jsx';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;

/** Visual normaliser for each measured feature. Purely presentation: the value
 *  shown is always the exact number returned by the inference service. */
const SIGNAL_SCALE = {
  review_length: (v) => Math.min(100, (v / 200) * 100),
  char_length: (v) => Math.min(100, (v / 1200) * 100),
  repetition_ratio: (v) => Math.min(100, v * 100),
  sentiment: (v) => ((v + 1) / 2) * 100,
  promo_score: (v) => Math.min(100, (v / 8) * 100),
  rating_sent_gap: (v) => Math.min(100, (v / 4.5) * 100),
  avg_word_length: (v) => Math.min(100, (v / 9) * 100),
  short_flag: (v) => (v >= 1 ? 100 : 4),
  sim_score: (v) => Math.min(100, v * 100)
};

const SIGNAL_TONE = {
  sentiment: 'pos',
  rating_sent_gap: 'neg',
  repetition_ratio: 'neg',
  short_flag: 'neg'
};

function fmt(v, unit) {
  if (!isNum(v)) return '—';
  const shown = Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
  return unit && unit !== '0 or 1' ? `${shown} ${unit}` : shown;
}

/** Short, non-invented hint: the feature's own description, trimmed on a word
 *  boundary. The full text stays in the title attribute and in the "full
 *  measured feature details" table. */
function shortDesc(text) {
  if (!text) return '';
  if (text.length <= 88) return text;
  const cut = text.slice(0, 88);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export default function ExplainableAI() {
  const navigate = useNavigate();
  const selection = useSelection();
  const { data: history, loading, error, reload } = useFetch(() => api.history(), []);
  const [query, setQuery] = useState('');
  const stackRef = useRef(null);
  const lastId = useRef(selection?.id ?? null);

  const a = selection?.analysis ?? null;
  const evidence = a?.evidence ?? null;
  const signals = useMemo(() => evidence?.measuredSignals || [], [evidence]);
  const pFake = a?.probabilities && isNum(a.probabilities.fake) ? a.probabilities.fake : null;
  const threshold = isNum(evidence?.threshold) ? evidence.threshold : null;

  const allRecords = useMemo(() => (Array.isArray(history) ? [...history].reverse() : []), [history]);
  const records = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRecords;
    return allRecords.filter((r) =>
      `${r.text || ''} ${r.evidence?.reviewText || ''} ${r.productName || ''} ${r.productCategory || ''} ${r.prediction || ''}`
        .toLowerCase().includes(q));
  }, [allRecords, query]);

  // Bring the workspace into view after a deliberate selection change, so the
  // record picked near the bottom is actually read at the top.
  useEffect(() => {
    if (!selection || selection.id === lastId.current) { lastId.current = selection?.id ?? null; return; }
    lastId.current = selection.id;
    const el = stackRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const y = el.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
  }, [selection]);

  // Default to the most recent saved analysis (preferring one that carries
  // evidence) unless the user deliberately cleared the workspace.
  useEffect(() => {
    if (selection || loading || error) return;
    if (!Array.isArray(history) || history.length === 0) return;
    if (isSelectionDismissed()) return;
    const latest = [...history].reverse().find((r) => r.evidence) || history[history.length - 1];
    if (latest) saveSelection(selectionFromHistory(latest));
  }, [selection, loading, error, history]);

  function selectRecord(rec) {
    const sel = selectionFromHistory(rec);
    if (sel) saveSelection(sel);
  }

  function selectLatest() {
    const rows = history || [];
    const latest = [...rows].reverse().find((r) => r.evidence) || rows[rows.length - 1];
    if (latest) selectRecord(latest);
  }

  function doClear() { clearSelection(); }

  return (
    <div className="page">
      <PageHeader
        index="04"
        eyebrow="Interpretation workspace"
        title={<>Explainable <span className="grad-text">AI</span></>}
        description="Evidence and model diagnostics for the selected review."
        meta={[
          { k: 'Verdict', v: a?.prediction ? a.prediction.toUpperCase() : '—', tone: a?.prediction === 'fake' ? 'fake' : a?.prediction === 'genuine' ? 'genuine' : undefined },
          { k: 'P(fake)', v: pFake != null ? pct(pFake) : '—' },
          { k: 'Evidence', v: evidence ? 'Saved' : 'None' }
        ]}
        actions={selection && (
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={selectLatest}>Most recent</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={doClear}>Clear</button>
          </div>
        )}
      />

      {!selection && (
        <section className="glass-card xai-empty enter enter-1">
          <span className="xai-empty-glyph" aria-hidden="true"><IconBrain width="26" height="26" /></span>
          <h2>No review selected yet</h2>
          <p>
            Analyze a review in the Review Analyzer and its result is selected here automatically, or open any
            saved record from Prediction history below. This page never invents a sample result to display.
          </p>
          <div className="row xai-empty-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/analyzer')}>
              Open Review Analyzer
            </button>
            {allRecords.length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={selectLatest}>
                Open most recent analysis
              </button>
            )}
          </div>
          <p className="xai-empty-note">Every section below fills in once a record is selected.</p>
        </section>
      )}

      {selection && (
        <div className="xai-stack" ref={stackRef}>
          <PredictionPanel a={a} evidence={evidence} pFake={pFake} threshold={threshold} />

          <section className="xai-sec enter enter-2">
            <SectionHead index="02" title="Selected review" hint="the exact text this evidence belongs to" />
            <div className="glass-card xai-review">
              <div className="xai-review-top">
                <div className="meta-strip">
                  {a?.productName && <span className="chip strong">{a.productName}</span>}
                  <span className="chip cat">{a?.productCategory || 'Uncategorized'}</span>
                  {a?.rating ? <span className="chip">{'★'.repeat(a.rating)}{'☆'.repeat(Math.max(0, 5 - a.rating))}</span> : null}
                  {a?.analyzedAt && <span className="chip faint-chip">{a.analyzedAt}</span>}
                  {a?.modelVersion && <span className="chip faint-chip">model {a.modelVersion}</span>}
                  {a?.batchId && <span className="chip faint-chip">batch {a.batchId}</span>}
                </div>
                <span className="xai-source">
                  {selection.source === 'history' ? 'from prediction history' : 'from the analyzer'}
                </span>
              </div>

              <blockquote className="review-quote">{evidence?.reviewText ?? a?.text ?? '—'}</blockquote>

              {!evidence && a?.prediction && (
                <Banner kind="info" style={{ marginTop: 14 }}>
                  <b>No saved evidence for this record.</b> It was stored before the evidence pipeline was
                  connected. Re-run it in the <Link to="/analyzer" style={{ textDecoration: 'underline' }}>Review Analyzer</Link>{' '}
                  to generate full evidence — nothing is reconstructed or guessed for old records.
                </Banner>
              )}

              <div className="xai-review-foot">
                <span className="faint small">Review id <span className="mono">{selection.id}</span></span>
                <Link to="/analyzer" className="btn btn-secondary btn-sm">Analyze another</Link>
              </div>
            </div>
          </section>

          {evidence ? (
            <>
              <EvidenceSection signals={signals} />
              <SummarySection evidence={evidence} />
              <DiagnosticsSection evidence={evidence} signals={signals} />
            </>
          ) : null}
        </div>
      )}

      <section className="xai-sec enter enter-3">
        <SectionHead
          index={evidence ? '06' : '02'}
          title="Prediction history"
          hint="open any saved record — every section above follows your selection"
        />
        <div className="glass-card xai-hist">
          <div className="xai-hist-bar">
            <div className="search-box">
              <IconSearch />
              <input className="text-input" type="search"
                placeholder="Search text, product or verdict…"
                value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search saved predictions" />
            </div>
            <span className="xai-hist-count">
              <b>{records.length}</b> of {allRecords.length} records
            </span>
          </div>

          {loading && <p className="small muted" style={{ marginTop: 10 }}>Loading prediction history…</p>}
          {error && (
            <StateBlock kind="error" title="Could not load history"
              action={<button type="button" className="btn btn-primary btn-sm" onClick={reload}>Retry</button>}>
              {error.message}
            </StateBlock>
          )}
          {!loading && !error && records.length === 0 && (
            <StateBlock kind="info" title={query ? 'No matching records' : 'No analyses yet'}
              action={!query && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/analyzer')}>
                  Open Review Analyzer
                </button>
              )}>
              {query ? 'No saved record matches that search.' : 'Once you analyze a review it appears here with its saved evidence.'}
            </StateBlock>
          )}
          {!loading && !error && records.length > 0 && (
            <div className="xh-list">
              {records.map((rec) => {
                const selected = selection?.source === 'history' && selection.id === `history:${rec.id}`;
                const text = rec.evidence?.reviewText || rec.text || '—';
                return (
                  <button type="button" key={rec.id} className={`xh-row${selected ? ' selected' : ''}`}
                    onClick={() => selectRecord(rec)} aria-current={selected ? 'true' : undefined}>
                    <span className={`xai-dot ${rec.prediction || 'neutral'}`} aria-hidden="true" />
                    <span className="xh-body">
                      <span className="xh-line">
                        <span className={`badge badge-${rec.prediction || 'neutral'}`}>{rec.prediction || '—'}</span>
                        <span className="xh-text" title={text}>{text}</span>
                      </span>
                      <span className="xh-meta">
                        {rec.productCategory || 'Uncategorized'}
                        {rec.rating ? ` · ${rec.rating}★` : ''}
                        {rec.analyzedAt ? ` · ${rec.analyzedAt}` : ''}
                        {rec.evidence ? ' · evidence saved' : ' · no saved evidence'}
                      </span>
                    </span>
                    <span className="xh-state">{selected ? 'Selected' : ''}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <Banner kind="info">
        Want to measure these signals on another review? Run it through the{' '}
        <Link to="/analyzer" style={{ textDecoration: 'underline' }}>Review Analyzer</Link> — its result becomes the
        selected evidence here automatically.
      </Banner>
    </div>
  );
}

function SectionHead({ index, title, hint }) {
  return (
    <div className="xai-head">
      {index && <span className="xai-head-num" aria-hidden="true">{index}</span>}
      <h2>{title}</h2>
      <span className="xai-rule" aria-hidden="true" />
      {hint && <span className="xai-head-hint">{hint}</span>}
    </div>
  );
}

function Fact({ label, tag, value, tone }) {
  return (
    <div className="fact">
      <div className="fact-k">{label} <span className={tag === 'model' ? 'tag-model' : 'tag-derived'}>{tag}</span></div>
      <div className="fact-v" style={{ color: tone }}>{value}</div>
    </div>
  );
}

function PredictionPanel({ a, evidence, pFake, threshold }) {
  const prediction = a?.prediction || null;
  const risk = a?.riskLevel || null;
  const riskColor = risk === 'high' ? 'var(--fake)' : risk === 'low' ? 'var(--genuine)' : risk === 'medium' ? 'var(--amber)' : undefined;

  return (
    <section className="xai-sec enter enter-1">
      <SectionHead index="01" title="Prediction overview" hint="model output · saved decision threshold" />
      <div className={`glass-card xai-pred${prediction ? ` ${prediction}` : ''}`}>
        <div className="xai-pred-head">
          <span className="xai-kicker">Model output · binary stacking ensemble</span>
          <span className={`badge badge-${prediction || 'neutral'}`}>{prediction || 'no prediction'}</span>
        </div>

        <div className="xai-pred-grid">
          <div className="xai-verdict">
            <div className="xai-k">Verdict</div>
            <div className="xai-word">{prediction ? prediction.toUpperCase() : 'NO VERDICT'}</div>
            <div className="xai-vsub">
              {pFake != null && threshold != null ? (
                <>P(fake) <b className="mono">{pFake.toFixed(4)}</b> against the saved threshold <b className="mono">{threshold.toFixed(4)}</b></>
              ) : pFake != null ? (
                <>P(fake) <b className="mono">{pFake.toFixed(4)}</b></>
              ) : 'This selection carries no model output.'}
            </div>
          </div>

          {pFake != null && (
            <div className="xai-prob-pair">
              <div className="xai-prob-cell fake">
                <div className="xai-k">P(fake)</div>
                <div className="xai-prob-num">{pct(pFake, 2)}</div>
              </div>
              <div className="xai-prob-cell genuine">
                <div className="xai-k">P(genuine)</div>
                <div className="xai-prob-num">{pct(1 - pFake, 2)}</div>
                <div className="xai-prob-note">complement</div>
              </div>
            </div>
          )}
        </div>

        {pFake != null && (
          <div className="xai-rail-wrap">
            <div className="xai-rail" role="img"
              aria-label={`P(fake) ${pct(pFake, 2)}, P(genuine) ${pct(1 - pFake, 2)}${threshold != null ? `, saved decision threshold ${threshold.toFixed(4)}` : ''}`}>
              <span className="xai-rail-fake" style={{ width: `${pFake * 100}%` }} />
              <span className="xai-rail-genuine" style={{ width: `${(1 - pFake) * 100}%` }} />
              {threshold != null && (
                <i className="xai-thresh" style={{ left: `${Math.max(0, Math.min(100, threshold * 100))}%` }}
                  title={`Saved decision threshold ${threshold.toFixed(4)}`} />
              )}
            </div>
            <div className="xai-rail-legend">
              <span className="fake"><b>Fake</b> · {pct(pFake, 2)}</span>
              {threshold != null && <span className="thresh"><b>Threshold</b> · {threshold.toFixed(4)}</span>}
              <span className="genuine"><b>Genuine</b> · {pct(1 - pFake, 2)}</span>
            </div>
          </div>
        )}

        <div className="xai-facts">
          <Fact label="Confidence" tag="model" value={a?.confidence != null ? pct(a.confidence) : '—'} />
          <Fact label="Trust score" tag="derived" value={<>{a?.trustScore != null ? a.trustScore : '—'}<small>/100</small></>} />
          <Fact label="Risk level" tag="derived" value={<span style={{ textTransform: 'capitalize' }}>{risk || '—'}</span>} tone={riskColor} />
        </div>

        <p className="xai-footnote">
          Confidence is the model&apos;s probability for the predicted class. Trust and risk are derived for display
          only — trust = 100 − round(P(fake) × 100), risk = fake → high / genuine → low. They are not separate
          model predictions.
        </p>

        {!evidence && (
          <p className="xai-footnote">No measured evidence is stored with this record, so sections 03–05 are not shown.</p>
        )}
      </div>
    </section>
  );
}

function EvidenceSection({ signals }) {
  return (
    <section className="xai-sec enter enter-2">
      <SectionHead index="03" title="Measured evidence" hint="features computed by the model&apos;s own pipeline for this review" />
      <div className="xai-ev-grid">
        {signals.map((s) => {
          const scale = SIGNAL_SCALE[s.key];
          const width = s.available && isNum(s.value) && scale ? Math.max(2, Math.min(100, scale(s.value))) : 0;
          const tone = SIGNAL_TONE[s.key] || '';
          return (
            <article className={`xai-ev${s.available ? '' : ' unavailable'}`} key={s.key} title={s.available ? s.description : s.unavailableReason}>
              <div className="xai-ev-k">
                <span>{s.label}</span>
                <span className="xai-ev-tag">measured</span>
              </div>
              <div className="xai-ev-v">
                {s.available ? fmt(s.value, s.unit) : <span className="faint" style={{ fontSize: 14 }}>unavailable</span>}
              </div>
              {s.available && isNum(s.value) && scale && (
                <div className={`ev-bar ${tone}`} aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
              )}
              <p className="xai-ev-hint">
                {s.available ? shortDesc(s.description) : s.unavailableReason}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SummarySection({ evidence }) {
  const measured = (evidence.topEvidence || []).filter((e) => e.category === 'measured');
  return (
    <section className="xai-sec enter enter-3">
      <SectionHead index="04" title="Explanation summary" hint="generated from this record&apos;s model output and measured signals" />
      <div className="glass-card xai-summary">
        <div className="xai-summary-grid">
          <div className="xai-summary-ind">
            <div className="xai-k">Measured indicators</div>
            {measured.length > 0 ? (
              <div className="chip-cloud">
                {measured.map((m) => (
                  <span className="xai-ind" key={m.id} title={m.detail}>{m.label}</span>
                ))}
              </div>
            ) : (
              <p className="faint small">No measured indicator was selected as a headline for this record.</p>
            )}
            <p className="xai-footnote" style={{ marginTop: 10 }}>
              These are properties of this review&apos;s text, computed by the feature pipeline.
            </p>
          </div>
          <div className="xai-summary-text-wrap">
            <div className="xai-k">What the explanation reports</div>
            <p className="xai-sum-text">{evidence.explanationSummary}</p>
          </div>
        </div>
        <p className="xai-footnote">
          Indicators are measurements, not conclusions: no single feature proves that this review is fake or
          genuine, and the summary states what the model computed rather than why it decided.
        </p>
      </div>
    </section>
  );
}

function DiagnosticsSection({ evidence, signals }) {
  const promo = (evidence.suspiciousWords || []).filter((w) => /promotional/i.test(w.reason));
  const repeated = (evidence.suspiciousWords || []).filter((w) => !/promotional/i.test(w.reason));
  const attribution = evidence.attribution;
  const limitations = evidence.limitations || [];

  return (
    <section className="xai-sec enter enter-3">
      <SectionHead index="05" title="Advanced diagnostics" hint="expand a section to inspect the technical detail" />
      <div className="xai-acc-group">
        <Accordion
          title="Detected wording"
          meta={`${promo.length + repeated.length} term${promo.length + repeated.length === 1 ? '' : 's'}`}
        >
          <p className="xai-acc-lede">
            Exact terms matched by the documented signals. Flags are measurements of wording — never proof of deception.
          </p>
          {promo.length === 0 && repeated.length === 0 ? (
            <p className="small muted">No promotional keywords and no repeated words were found in this review.</p>
          ) : (
            <div className="chip-cloud">
              {promo.map((w) => (
                <span className="term-pill" key={`p-${w.word}`} title={w.reason}>
                  {w.word}<b>×{w.count}</b><span className="faint" style={{ fontSize: 10 }}>promo</span>
                </span>
              ))}
              {repeated.map((w) => (
                <span className="term-pill repeat" key={`r-${w.word}`} title={w.reason}>
                  {w.word}<b>×{w.count}</b><span className="faint" style={{ fontSize: 10 }}>repeat</span>
                </span>
              ))}
            </div>
          )}
        </Accordion>

        <Accordion
          title="Term ablation"
          meta="perturbation sensitivity · not SHAP, not LIME"
          tag="model"
        >
          <AblationBody attribution={attribution} />
        </Accordion>

        <Accordion title="Full measured feature details" meta={`${signals.length} features`}>
          <p className="xai-acc-lede">
            Raw values exactly as returned by the inference service for this record, with the definition each feature
            carries in the pipeline.
          </p>
          <div className="xai-table-wrap">
            <table className="xai-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>What it measures</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.key}>
                    <td>
                      <div className="xai-td-label">{s.label}</div>
                      <code className="xai-td-key">{s.key}</code>
                    </td>
                    <td className="xai-td-val">{s.available ? String(s.value) : '—'}</td>
                    <td className="xai-td-unit">{s.available ? (s.unit || '—') : '—'}</td>
                    <td className="xai-td-desc">{s.available ? s.description : s.unavailableReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Accordion>

        <Accordion title="Decision pipeline &amp; methodology" meta="how these values are produced">
          <p className="xai-acc-lede">
            Architecture of the ML system this record came from, and what each displayed value means.
          </p>
          <PipelineDiagram />
          <dl className="xai-defs">
            <div>
              <dt>Class label <span className="tag-model">model</span></dt>
              <dd>Fake or Genuine — the binary classifier applies the saved decision threshold to the stacking
                meta-model probability. There is no trained Suspicious class.</dd>
            </div>
            <div>
              <dt>Probabilities <span className="tag-model">model</span></dt>
              <dd>P(fake) and P(genuine) come straight from the meta-model and are complementary. The API carries
                exactly these two keys.</dd>
            </div>
            <div>
              <dt>Confidence <span className="tag-model">model</span></dt>
              <dd>The meta-model probability of the predicted class. Confidence 0.89 for Genuine means the model
                assigned 89% to Genuine.</dd>
            </div>
            <div>
              <dt>Trust score <span className="tag-derived">derived</span></dt>
              <dd>Presentation value: 100 − round(P(fake) × 100). It restates the probability on a 0–100 scale — it is
                not a separately trained head.</dd>
            </div>
            <div>
              <dt>Risk level <span className="tag-derived">derived</span></dt>
              <dd>Derived mapping: Fake → high, Genuine → low. It adds no information beyond the verdict itself.</dd>
            </div>
            <div>
              <dt>Measured signals <span className="badge badge-neutral">measured</span></dt>
              <dd>The nine handcrafted features the pipeline actually consumes, reported verbatim. They are inputs and
                diagnostics, not proof of deception.</dd>
            </div>
          </dl>
        </Accordion>

        <Accordion title="What this model cannot establish" meta={`${limitations.length} limitation${limitations.length === 1 ? '' : 's'}`} tone="warn">
          <ul className="xai-limits">
            {limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </Accordion>
      </div>
    </section>
  );
}

function Accordion({ title, tag, meta, tone, children }) {
  return (
    <details className={`xai-acc${tone ? ` ${tone}` : ''}`}>
      <summary>
        <span className="xai-acc-caret" aria-hidden="true" />
        <span className="xai-acc-title">{title}</span>
        {tag && <span className="tag-model">{tag}</span>}
        {meta && <span className="xai-acc-meta">{meta}</span>}
      </summary>
      <div className="xai-acc-body">{children}</div>
    </details>
  );
}

function AblationBody({ attribution }) {
  if (!attribution) return null;
  const available = attribution.status === 'available' && Array.isArray(attribution.terms) && attribution.terms.length > 0;
  const maxAbs = available ? Math.max(...attribution.terms.map((t) => Math.abs(t.deltaFakeProbability)), 1e-9) : 1;

  return (
    <>
      <p className="xai-acc-lede">
        Each term is deleted from this review and the <b>entire pipeline is re-run</b>. Bars show the measured change
        in the model&apos;s P(fake) — a <b>perturbation sensitivity</b>, not SHAP, not LIME, and not a causal claim.
      </p>
      <span className="chip faint-chip">{attribution.method || 'unavailable'}</span>

      {available ? (
        <>
          <div className="abl-chart">
            {attribution.terms.map((t) => {
              const positive = t.deltaFakeProbability > 0;
              const zero = Math.abs(t.deltaFakeProbability) < 1e-9;
              const width = zero ? 0 : Math.max(1.5, (Math.abs(t.deltaFakeProbability) / maxAbs) * 48);
              return (
                <div className="abl-row" key={t.term}
                  title={`P(fake) original ${t.pFakeOriginal.toFixed(4)} → without "${t.term}" ${t.pFakeWithoutTerm.toFixed(4)}`}>
                  <span className="abl-term">“{t.term}”</span>
                  <div className="abl-track" aria-hidden="true">
                    <span className={`abl-bar ${positive ? 'pos' : zero ? '' : 'neg'}`} style={{ width: `${width}%` }} />
                  </div>
                  <span className={`abl-delta ${positive ? 'pos' : zero ? '' : 'neg'}`}>
                    {t.deltaFakeProbability >= 0 ? '+' : ''}{t.deltaFakeProbability.toFixed(4)}
                  </span>
                  <span className="abl-note">
                    <span className="mono">{t.pFakeOriginal.toFixed(4)} → {t.pFakeWithoutTerm.toFixed(4)}</span>
                    {t.wouldChangeLabel && <span className="flip-badge">flips to {t.labelWithoutTerm}</span>}
                    {!t.wouldChangeLabel && <span>verdict holds</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="faint small" style={{ marginTop: 12 }}>{attribution.description}</p>
          {Array.isArray(attribution.partialFailures) && attribution.partialFailures.length > 0 && (
            <p className="small muted" style={{ marginTop: 6 }}>
              Not every candidate could be evaluated: {attribution.partialFailures.join('; ')}.
            </p>
          )}
        </>
      ) : (
        <Banner kind="info" style={{ marginTop: 12 }}>
          <b>Attribution unavailable for this review:</b> {attribution.unavailableReason} No substitute numbers are
          shown in its place.
        </Banner>
      )}
    </>
  );
}
