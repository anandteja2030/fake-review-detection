import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFetch } from '../hooks/useModels.js';
import { api } from '../api/client.js';
import StateBlock from '../components/ui/StateBlock.jsx';
import DonutChart from '../components/charts/DonutChart.jsx';
import { CLASS_COLORS } from '../components/charts/palette.js';
import { IconSearch } from '../components/layout/Icons.jsx';
import { saveSelection, selectionFromHistory } from '../lib/evidenceStore.js';

const UNCATEGORIZED = 'Uncategorized';

export default function History() {
  const navigate = useNavigate();
  const { data: catData } = useFetch(() => api.categories());
  const [category, setCategory] = useState('');
  const [verdict, setVerdict] = useState('');
  const { data: history, loading, error, reload } = useFetch(() => api.history({ category, verdict }));
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState('');

  // Known categories (from the API) plus any that appear in loaded records.
  const categoryOptions = useMemo(() => {
    const known = catData?.categories || [];
    const seen = (history || []).map((h) => h.productCategory || UNCATEGORIZED);
    return [...new Set([...known, ...seen])];
  }, [catData, history]);

  /** Select this record's saved evidence on the Explainable AI page. */
  function explain(rec) {
    const sel = selectionFromHistory(rec);
    if (sel && saveSelection(sel)) navigate('/explainability');
  }

  async function handleClear() {
    if (!confirm('Clear all recorded prediction history? This cannot be undone.')) return;
    setClearing(true);
    try { await api.clearHistory(); reload(); } finally { setClearing(false); }
  }

  const q = query.trim().toLowerCase();
  const filtered = (history || []).filter((h) =>
    !q ||
    (h.text || '').toLowerCase().includes(q) ||
    (h.prediction || '').toLowerCase().includes(q) ||
    (h.productName || '').toLowerCase().includes(q) ||
    (h.productCategory || '').toLowerCase().includes(q) ||
    String(h.rating).includes(q)
  );
  const filtersActive = Boolean(category || verdict || q);

  return (
    <div className="page">
      <div className="page-header spread enter">
        <div>
          <h1>Prediction History</h1>
          <p>Every model-connected analysis recorded with its full result and product metadata. Records are created only when the model produces a real prediction — no placeholder rows.</p>
          <p className="faint small" style={{ marginTop: 6 }}>Records persist in <code>server/src/data/prediction_history.json</code>.</p>
        </div>
        {history?.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={handleClear} disabled={clearing}>
            {clearing ? 'Clearing…' : 'Clear History'}
          </button>
        )}
      </div>

      {loading && <div className="skeleton" style={{ height: 260 }} />}

      {error && <StateBlock kind="error" title="Could not load history" action={<button className="btn btn-primary btn-sm" onClick={reload}>Retry</button>}>{error.message}</StateBlock>}

      {!loading && !error && (history?.length === 0 && !filtersActive) && (
        <div className="card">
          <StateBlock kind="info" title="No predictions recorded yet">
            Analyze one or more reviews in the Review Analyzer — each model verdict with its probabilities,
            trust score, risk level, star rating, and product category is logged here automatically.
          </StateBlock>
        </div>
      )}

      {!loading && !error && (history?.length > 0 || filtersActive) && (
        <>
          <div className="dash-split-rev" style={{ marginBottom: 20 }}>
            <div className="card hoverable lit">
              <div className="card-title">Verdict Split</div>
              <div className="card-sub">Binary classes only — the model has no Suspicious class</div>
              <DonutChart
                data={[
                  { name: 'Fake', value: history.filter((h) => h.prediction === 'fake').length, color: CLASS_COLORS.fake },
                  { name: 'Genuine', value: history.filter((h) => h.prediction === 'genuine').length, color: CLASS_COLORS.genuine }
                ]}
                centerValue={history.length} centerLabel="records" height={230} />
            </div>
            <div className="card">
              <div className="card-title">What is recorded</div>
              <ul className="small muted" style={{ paddingLeft: 18, display: 'grid', gap: 6 }}>
                <li>Review text (first 200 chars) and its individual star rating</li>
                <li>Product name (optional) and product category (required for batches)</li>
                <li>Binary verdict with complementary probabilities</li>
                <li>Confidence (model) · trust score and risk level (derived)</li>
                <li>Lexicon sentiment label and rating–sentiment gap</li>
                <li>Model version, batch id, and UTC timestamp</li>
              </ul>
              <p className="faint small" style={{ marginTop: 10 }}>
                Product category is review metadata for organization and filtering — it is <b>not</b> a model feature.
                Records stored before metadata existed display as <b>{UNCATEGORIZED}</b>.
              </p>
            </div>
          </div>

          <div className="card">
            <div className="section-head wrap">
              <div>
                <div className="card-title">Stored History</div>
                <div className="card-sub" style={{ marginBottom: 0 }}>
                  {filtersActive
                    ? `${filtered.length} of ${history.length} record${history.length === 1 ? '' : 's'} match the current filters`
                    : `${history.length} record${history.length === 1 ? '' : 's'}`}
                </div>
              </div>
              <div className="filter-row">
                <select className="text-input filter-select" value={category} aria-label="Filter by product category"
                  onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="text-input filter-select" value={verdict} aria-label="Filter by verdict"
                  onChange={(e) => setVerdict(e.target.value)}>
                  <option value="">All verdicts</option>
                  <option value="fake">Fake</option>
                  <option value="genuine">Genuine</option>
                </select>
                <div className="search-box">
                  <IconSearch width="15" height="15" />
                  <input className="text-input" type="search" placeholder="Search text, product, category…"
                    value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search history" />
                </div>
              </div>
            </div>

            {filtered.length === 0 ? (
              <StateBlock kind="info" title="No matching records"
                action={filtersActive
                  ? <button className="btn btn-secondary btn-sm" onClick={() => { setCategory(''); setVerdict(''); setQuery(''); }}>Reset filters</button>
                  : null}>
                {filtersActive
                  ? 'No history entries match the current category/verdict/search filters.'
                  : 'No history entries match your search.'}
              </StateBlock>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Product</th><th>Category</th><th>Review</th><th>Rating</th><th>Verdict</th>
                      <th>P(Fake) / P(Genuine)</th><th>Trust</th><th>Risk</th><th>Sentiment</th><th>Analyzed (UTC)</th><th>Model</th><th>Explain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((h, i) => (
                      <tr key={h.id || i}>
                        <td className="faint">{i + 1}</td>
                        <td className="cell-product">{h.productName || <span className="faint">—</span>}</td>
                        <td><span className="chip cat small-chip">{h.productCategory || UNCATEGORIZED}</span></td>
                        <td className="cell-text" title={h.text}>{h.text}</td>
                        <td>{h.rating}★</td>
                        <td><span className={`badge badge-${h.prediction}`}>{h.prediction}</span></td>
                        <td className="mono">
                          {h.probabilities
                            ? `${Math.round((h.probabilities.fake ?? 0) * 100)}% / ${Math.round((h.probabilities.genuine ?? 0) * 100)}%`
                            : '—'}
                        </td>
                        <td>{h.trustScore ?? '—'}</td>
                        <td>{h.riskLevel ?? '—'}</td>
                        <td>{h.sentimentLabel ?? '—'}</td>
                        <td className="faint small">{h.analyzedAt}</td>
                        <td className="faint small">{h.modelVersion ?? '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title={h.evidence
                              ? 'Open the evidence saved with this record'
                              : 'No evidence stored for this record — re-analyze it to generate evidence'}
                            onClick={() => explain(h)}
                          >
                            Explain
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
