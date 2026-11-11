import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFetch } from '../hooks/useModels.js';
import { api } from '../api/client.js';
import StateBlock from '../components/ui/StateBlock.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import DonutChart from '../components/charts/DonutChart.jsx';
import { CLASS_COLORS } from '../components/charts/palette.js';
import { IconSearch, IconChevronRight, IconBrain, IconReset } from '../components/layout/Icons.jsx';
import { saveSelection, selectionFromHistory } from '../lib/evidenceStore.js';
import {
  UNCATEGORIZED, categoryOptions, filterHistoryRecords, hasActiveFilters, verdictCounts
} from '../lib/historyFilters.js';

const verdictFilters = [
  { value: '', label: 'All' },
  { value: 'fake', label: 'Fake' },
  { value: 'genuine', label: 'Genuine' }
];

export default function History() {
  const navigate = useNavigate();
  // One fetch, filtered locally: selectors update immediately and combine.
  const { data: history, loading, error, reload } = useFetch(() => api.history(), []);
  const [category, setCategory] = useState('');
  const [verdict, setVerdict] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [clearing, setClearing] = useState(false);

  const records = useMemo(() => (Array.isArray(history) ? history : []), [history]);
  const options = useMemo(() => categoryOptions(records), [records]);
  const counts = useMemo(() => verdictCounts(records), [records]);
  const filtered = useMemo(
    () => filterHistoryRecords(records, { category, verdict, query }),
    [records, category, verdict, query]
  );
  const active = hasActiveFilters({ category, verdict, query });

  function explain(rec) {
    const sel = selectionFromHistory(rec);
    if (sel && saveSelection(sel)) navigate('/explainability');
  }

  function reset() {
    setCategory('');
    setVerdict('');
    setQuery('');
  }

  async function handleClear() {
    if (!confirm('Clear all recorded prediction history? This cannot be undone.')) return;
    setClearing(true);
    try { await api.clearHistory(); reload(); } finally { setClearing(false); }
  }

  return (
    <div className="page">
      <PageHeader
        index="06"
        eyebrow="Record archive"
        title={<>Prediction <span className="grad-text">history</span></>}
        description="Every model-connected analysis, stored with its verdict, probabilities and product metadata. Filters read the saved fields directly — existing records are never rewritten to make them match."
        meta={[
          { k: 'Records', v: loading ? '…' : counts.total },
          { k: 'Fake', v: loading ? '…' : counts.fake, tone: 'fake' },
          { k: 'Genuine', v: loading ? '…' : counts.genuine, tone: 'genuine' },
          { k: 'No verdict', v: loading ? '…' : counts.unpredicted }
        ]}
        actions={records.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={handleClear} disabled={clearing}>
            {clearing ? 'Clearing…' : 'Clear history'}
          </button>
        )}
      />

      {loading && <div className="skeleton" style={{ height: 300 }} />}

      {error && (
        <StateBlock kind="error" title="Could not load history"
          action={<button className="btn btn-primary btn-sm" onClick={reload}>Retry</button>}>
          {error.message}
        </StateBlock>
      )}

      {!loading && !error && records.length === 0 && (
        <div className="glass-card">
          <StateBlock kind="info" title="No predictions recorded yet">
            Analyze one or more reviews in the Review Analyzer — each model verdict with its probabilities,
            trust score, risk level, star rating and product category is logged here automatically.
          </StateBlock>
        </div>
      )}

      {!loading && !error && records.length > 0 && (
        <>
          <section className="hist-toolbar glass-card" aria-label="History filters">
            <div className="hist-filter">
              <label className="hist-label" htmlFor="hist-category">Category</label>
              <div className="select-wrap">
                <select id="hist-category" className="text-input filter-select" value={category}
                  onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {options.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="hist-filter">
              <span className="hist-label" id="hist-verdict-label">Verdict</span>
              <div className="seg" role="group" aria-labelledby="hist-verdict-label">
                {verdictFilters.map((v) => (
                  <button
                    key={v.value || 'all'}
                    type="button"
                    className={`seg-btn${verdict === v.value ? ' on' : ''}`}
                    aria-pressed={verdict === v.value}
                    onClick={() => setVerdict(v.value)}
                  >
                    {v.label}
                    <b>{v.value === '' ? counts.total : v.value === 'fake' ? counts.fake : counts.genuine}</b>
                  </button>
                ))}
              </div>
            </div>

            <div className="hist-filter grow">
              <label className="hist-label" htmlFor="hist-search">Search</label>
              <div className="search-box">
                <IconSearch />
                <input id="hist-search" className="text-input" type="search"
                  placeholder="Review text, product, category, rating…"
                  value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>

            <button type="button" className="btn btn-ghost btn-sm hist-reset"
              onClick={reset} disabled={!active}>
              <IconReset /> Reset
            </button>
          </section>

          <div className="hist-result-line">
            <span>
              <b>{filtered.length}</b> of <b>{records.length}</b> record{records.length === 1 ? '' : 's'}
              {active ? ' match the current filters' : ''}
            </span>
            <span className="faint small">
              categories and verdicts read from the saved record fields · legacy rows fall back to {UNCATEGORIZED}
            </span>
          </div>

          <div className="dash-split">
            <div className="glass-card hist-list-card">
              <div className="spread" style={{ marginBottom: 10 }}>
                <div className="deck-title">Stored records</div>
                <span className="faint small">click a row to expand</span>
              </div>

              {filtered.length === 0 ? (
                <StateBlock kind="info" title="No matching records"
                  action={active
                    ? <button className="btn btn-secondary btn-sm" onClick={reset}>Reset filters</button>
                    : null}>
                  No saved analysis matches this combination of category, verdict and search text.
                </StateBlock>
              ) : (
                <div className="history-list">
                  {filtered.map((h, i) => {
                    const id = h.id || `idx-${i}`;
                    const open = openId === id;
                    const cat = h.productCategory || UNCATEGORIZED;
                    return (
                      <div className={`hrow${open ? ' open' : ''}`} key={id}>
                        <button type="button" className="hrow-head" aria-expanded={open}
                          onClick={() => setOpenId(open ? null : id)}>
                          <span className="hrow-index">{String(i + 1).padStart(2, '0')}</span>
                          <span className={`badge badge-${h.prediction || 'neutral'}`}>{h.prediction || '—'}</span>
                          <span className="hrow-text" title={h.text}>
                            {h.productName && <b>{h.productName} — </b>}{h.text}
                          </span>
                          <span className="chip cat small-chip">{cat}</span>
                          <span className="hrow-meta">{h.rating}★ · trust {h.trustScore ?? '—'}</span>
                          <span className="hrow-caret"><IconChevronRight /></span>
                        </button>

                        {open && (
                          <div className="hrow-body">
                            <div className="hrow-quote">“{h.text}”</div>
                            <div className="detail-grid">
                              <Detail k="P(fake)" v={h.probabilities ? `${(h.probabilities.fake * 100).toFixed(1)}%` : '—'} />
                              <Detail k="P(genuine)" v={h.probabilities ? `${(h.probabilities.genuine * 100).toFixed(1)}%` : '—'} />
                              <Detail k="Confidence" v={h.confidence != null ? `${(h.confidence * 100).toFixed(1)}%` : '—'} />
                              <Detail k="Trust · derived" v={h.trustScore ?? '—'} />
                              <Detail k="Risk · derived" v={h.riskLevel ?? '—'} />
                              <Detail k="Sentiment" v={h.sentimentLabel ?? '—'} />
                              <Detail k="Rating gap" v={h.ratingSentimentGap ?? '—'} />
                              <Detail k="Model" v={h.modelVersion ?? '—'} />
                              <Detail k="Batch" v={h.batchId ?? '—'} />
                              <Detail k="Evidence" v={h.evidence ? 'saved' : 'not saved'} />
                            </div>
                            <div className="spread">
                              <span className="hrow-meta">analyzed {h.analyzedAt}</span>
                              <button type="button" className="btn btn-secondary btn-sm"
                                title={h.evidence
                                  ? 'Open the evidence saved with this record'
                                  : 'No evidence stored for this record — re-analyze it to generate evidence'}
                                onClick={() => explain(h)}>
                                <IconBrain /> Explain this verdict
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="stack">
              <div className="glass-card">
                <div className="deck-title">Verdict split</div>
                <div className="card-sub">Binary classes only — the model has no Suspicious class</div>
                <DonutChart
                  data={[
                    { name: 'Fake', value: counts.fake, color: CLASS_COLORS.fake },
                    { name: 'Genuine', value: counts.genuine, color: CLASS_COLORS.genuine }
                  ]}
                  centerValue={counts.total} centerLabel="records" height={210} />
              </div>

              <div className="glass-card">
                <div className="deck-title">What is recorded</div>
                <div className="card-sub">The stored schema for every analysis.</div>
                <ul className="limitations" style={{ gap: 6 }}>
                  <li>Review text excerpt and its individual star rating</li>
                  <li>Product name (optional) and product category</li>
                  <li>Binary verdict with complementary probabilities</li>
                  <li>Confidence (model) · trust score and risk level (derived)</li>
                  <li>Lexicon sentiment label and rating–sentiment gap</li>
                  <li>Model version, batch id and UTC timestamp</li>
                </ul>
                <p className="faint small" style={{ marginTop: 10 }}>
                  Product category is review metadata for organisation and filtering — it is <b>not</b> a model
                  feature. Records stored before metadata existed display as <b>{UNCATEGORIZED}</b>.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Detail({ k, v }) {
  return (
    <div className="detail-cell">
      <div className="detail-k">{k}</div>
      <div className="detail-v">{v}</div>
    </div>
  );
}
