import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFetch } from '../hooks/useModels.js';
import { useSelection } from '../hooks/useSelection.js';
import { api } from '../api/client.js';
import { saveSelection, selectionFromHistory } from '../lib/evidenceStore.js';
import StatCard from '../components/ui/StatCard.jsx';
import StateBlock from '../components/ui/StateBlock.jsx';
import Banner from '../components/ui/Banner.jsx';
import ChartCard from '../components/ui/ChartCard.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import DonutChart from '../components/charts/DonutChart.jsx';
import BarByKey from '../components/charts/BarByKey.jsx';
import TrendLine from '../components/charts/TrendLine.jsx';
import { CLASS_COLORS, SENTIMENT_COLORS, RATING_COLORS, SERIES_COLORS } from '../components/charts/palette.js';
import { IconActivity, IconAlertOctagon, IconThumbsUp, IconTarget, IconBrain } from '../components/layout/Icons.jsx';
import { UNCATEGORIZED, categoryOptions, filterHistoryRecords } from '../lib/historyFilters.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v, digits = 2) => `${(v * 100).toFixed(digits)}%`;
const fmtValue = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000));

export default function Analytics() {
  const navigate = useNavigate();
  const { data: stats, loading: l1, error: e1, reload } = useFetch(() => api.stats());
  const { data: latestWindow, loading: l2, error: e2 } = useFetch(() => api.metricsLatest());
  const { data: history, loading: lh, error: eh, reload: reloadHistory } = useFetch(() => api.history());
  const selection = useSelection();
  const hasHistory = stats && stats.totalReviews > 0;

  const records = useMemo(() => (Array.isArray(history) ? history : []), [history]);
  const latestRecord = records.length ? records[records.length - 1] : null;

  // ONE current-analysis record, shared with Explainable AI: the record the
  // user selected anywhere, or — with nothing selected — the newest saved
  // analysis. It is never derived from the aggregate statistics.
  const current = useMemo(
    () => selection ?? (latestRecord ? selectionFromHistory(latestRecord) : null),
    [selection, latestRecord]
  );
  const a = current?.analysis ?? null;
  const evidence = a?.evidence ?? null;
  const pFake = a?.probabilities && isNum(a.probabilities.fake) ? a.probabilities.fake : null;
  const threshold = isNum(evidence?.threshold) ? evidence.threshold : null;
  const isLatest = Boolean(latestRecord && a?.analyzedAt && a.analyzedAt === latestRecord.analyzedAt);

  // A newly saved analysis changes the context: re-read aggregates so the
  // historical layer includes it without a page reload.
  const lastName = useRef(current?.id ?? null);
  useEffect(() => {
    if (lastName.current === (current?.id ?? null)) return;
    lastName.current = current?.id ?? null;
    reload();
    reloadHistory();
  }, [current?.id, reload, reloadHistory]);

  function openInWorkspace() {
    if (!current) return;
    saveSelection(current);
    navigate('/explainability');
  }

  return (
    <div className="page">
      <PageHeader
        index="03"
        eyebrow="Usage intelligence"
        title={<>Analytics <span className="grad-text">workspace</span></>}
        description="Two separate layers: the analysis you are looking at right now, and aggregate insight computed from every recorded analysis — the current review is never folded into the statistics."
        meta={[
          { k: 'Analyses', v: l1 ? '…' : stats?.totalReviews ?? 0 },
          { k: 'Fake', v: l1 ? '…' : stats?.fake ?? 0, tone: 'fake' },
          { k: 'Genuine', v: l1 ? '…' : stats?.genuine ?? 0, tone: 'genuine' },
          { k: 'Avg trust', v: l1 ? '…' : stats?.averageTrustScore ?? '—' }
        ]}
        actions={<span className="provenance-chip live">Live usage data</span>}
      />

      <SectionHead
        index="01"
        title="Current analysis"
        hint={current
          ? (isLatest ? 'newest saved analysis · also open in Explainable AI' : 'the record selected in Explainable AI / history')
          : 'no record selected'}
      />

      {lh && !current && <div className="skeleton" style={{ height: 220, marginBottom: 18 }} />}

      {eh && !current && (
        <StateBlock kind="error" title="Could not load the current analysis"
          action={<button className="btn btn-primary btn-sm" onClick={reloadHistory}>Retry</button>}>
          {eh.message}
        </StateBlock>
      )}

      {!lh && !eh && !current && (
        <div className="glass-card ana-empty">
          <span className="ana-empty-glyph" aria-hidden="true"><IconBrain width="24" height="24" /></span>
          <div>
            <div className="deck-title">Nothing analyzed yet</div>
            <p className="muted small" style={{ marginTop: 4, maxWidth: '62ch' }}>
              Submit a review in the Review Analyzer and its saved result appears here — with its probabilities,
              measured indicators and the same review text Explainable AI inspects.
            </p>
          </div>
          <Link to="/analyzer" className="btn btn-primary btn-sm">Open Review Analyzer</Link>
        </div>
      )}

      {current && a && (
        <section className={`glass-card ana-current ${a.prediction || ''}`}>
          <div className="ana-cur-head">
            <div className="meta-strip">
              {a.productName && <span className="chip strong">{a.productName}</span>}
              <span className="chip cat">{a.productCategory || UNCATEGORIZED}</span>
              {a.rating ? (
                <span className="chip" aria-label={`${a.rating} of 5 stars`}>
                  {'★'.repeat(a.rating)}{'☆'.repeat(Math.max(0, 5 - a.rating))}
                </span>
              ) : null}
              {a.analyzedAt && <span className="chip faint-chip">{a.analyzedAt}</span>}
              <span className="chip faint-chip mono" title={`Review identifier ${current.id.replace(/^history:/, '')}`}>
                {current.id.replace(/^history:/, '')}
              </span>
            </div>
            <span className={`ana-flag${isLatest ? ' live' : ''}`}>
              {isLatest ? 'latest saved analysis' : 'selected record'}
            </span>
          </div>

          <div className="ana-cur-grid">
            <div className="ana-cur-verdict">
              <span className="xai-kicker">Model output · binary stacking ensemble</span>
              <div className={`ana-word ${a.prediction || ''}`}>{a.prediction ? a.prediction.toUpperCase() : 'NO VERDICT'}</div>
              <div className="ana-sub">
                {pFake != null && threshold != null ? (
                  <>P(fake) <b className="mono">{pFake.toFixed(4)}</b> against the saved threshold{' '}
                    <b className="mono">{threshold.toFixed(4)}</b></>
                ) : pFake != null ? (
                  <>P(fake) <b className="mono">{pFake.toFixed(4)}</b> · threshold not stored with this record</>
                ) : 'This record carries no model output.'}
              </div>

              <div className="ana-facts">
                <Fact k="Confidence" tag="model" v={a.confidence != null ? pct(a.confidence, 1) : '—'} />
                <Fact k="Trust score" tag="derived" v={a.trustScore != null ? `${a.trustScore}/100` : '—'} />
                <Fact k="Risk level" tag="derived" v={a.riskLevel || '—'}
                  tone={a.riskLevel === 'high' ? 'var(--fake)' : a.riskLevel === 'low' ? 'var(--genuine)' : a.riskLevel === 'medium' ? 'var(--amber)' : undefined} />
                <Fact k="Rating" tag="input" v={a.rating ? `${a.rating} ★` : '—'} />
              </div>
            </div>

            <div className="ana-cur-prob">
              <div className="xai-prob-pair">
                <div className="xai-prob-cell fake">
                  <span className="xai-k">P(fake)</span>
                  <div className="xai-prob-num">{pFake != null ? pct(pFake) : '—'}</div>
                </div>
                <div className="xai-prob-cell genuine">
                  <span className="xai-k">P(genuine)</span>
                  <div className="xai-prob-num">{pFake != null ? pct(1 - pFake) : '—'}</div>
                </div>
              </div>
              {pFake != null && (
                <div className="xai-rail-wrap">
                  <div className="xai-rail" role="img"
                    aria-label={`P(fake) ${pct(pFake)}, P(genuine) ${pct(1 - pFake)}`}>
                    <span className="xai-rail-fake" style={{ width: `${pFake * 100}%` }} />
                    <span className="xai-rail-genuine" style={{ width: `${(1 - pFake) * 100}%` }} />
                    {threshold != null && (
                      <i className="xai-thresh" style={{ left: `${Math.max(0, Math.min(100, threshold * 100))}%` }}
                        title={`Saved decision threshold ${threshold.toFixed(4)}`} />
                    )}
                  </div>
                  <div className="xai-rail-legend">
                    <span className="fake"><b>Fake</b> · {pct(pFake)}</span>
                    {threshold != null && <span className="thresh"><b>Threshold</b> · {threshold.toFixed(4)}</span>}
                    <span className="genuine"><b>Genuine</b> · {pct(1 - pFake)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <blockquote className="review-quote">{evidence?.reviewText ?? a.text ?? '—'}</blockquote>

          <div className="ana-ind-head">
            <span className="xai-k">Measured indicators</span>
            <span className="faint small">
              {evidence ? 'computed by the model pipeline for this exact review' : 'no evidence stored with this record'}
            </span>
          </div>
          {evidence ? (
            <div className="ana-ind-grid">
              {(evidence.measuredSignals || []).filter((s) => s.available).slice(0, 4).map((s) => (
                <div className="ana-ind" key={s.key} title={s.description}>
                  <span className="ana-ind-k">{s.label}</span>
                  <span className="ana-ind-v">
                    {fmtValue(s.value)}{s.unit && s.unit !== '0 or 1' ? <small> {s.unit}</small> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: 8 }}>
              This record predates the evidence pipeline. Re-run it in the Analyzer to measure indicators for it —
              nothing is reconstructed here.
            </p>
          )}

          <div className="ana-cur-foot">
            <span className="faint small">
              Review id <span className="mono">{current.id.replace(/^history:/, '')}</span>
              {evidence ? ' · evidence saved' : ' · no saved evidence'}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={openInWorkspace}>
              <IconBrain /> Open in Explainable AI
            </button>
          </div>
        </section>
      )}

      <SectionHead
        index="02"
        title="Historical analytics"
        hint={stats ? `aggregate over all ${stats.totalReviews} recorded analyses` : 'aggregate over recorded analyses'}
      />

      {!hasHistory && !l1 && !e1 && (
        <div style={{ marginBottom: 16 }}>
          <Banner kind="info">
            <b>No analyses recorded yet.</b> Once reviews are analyzed with the connected model, this layer fills
            with prediction, trust-score, rating and sentiment distributions computed from your actual usage.
          </Banner>
        </div>
      )}

      {e1 && (
        <StateBlock kind="error" title="Could not load analytics"
          action={<button className="btn btn-primary btn-sm" onClick={reload}>Retry</button>}>
          {e1.message}
        </StateBlock>
      )}

      <div className="grid grid-stats enter enter-1" style={{ marginBottom: 16 }}>
        <StatCard label="Total analyses" value={l1 ? '…' : stats?.totalReviews ?? 0} color="var(--accent)"
          hint="recorded predictions" icon={IconActivity} />
        <StatCard label="Predicted fake" value={l1 ? '…' : stats?.fake ?? 0} hint="model verdict"
          color={CLASS_COLORS.fake} icon={IconAlertOctagon} />
        <StatCard label="Predicted genuine" value={l1 ? '…' : stats?.genuine ?? 0} hint="model verdict"
          color={CLASS_COLORS.genuine} icon={IconThumbsUp} />
        <StatCard label="Avg trust score" value={l1 ? '…' : stats?.averageTrustScore ?? '—'}
          hint="derived from P(fake)" color="var(--accent-2)" icon={IconTarget} />
      </div>

      <div className="dash-split" style={{ marginBottom: 16 }}>
        <ChartCard title="Authenticity distribution" subtitle="Fake vs Genuine across every recorded analysis" loading={l1} error={e1}>
          <DonutChart
            data={stats ? [
              { name: 'Fake', value: stats.fake, color: CLASS_COLORS.fake },
              { name: 'Genuine', value: stats.genuine, color: CLASS_COLORS.genuine }
            ] : []}
            centerValue={stats?.totalReviews ?? 0} centerLabel="analyses" />
        </ChartCard>
        <ChartCard title="Trust score distribution" subtitle="Histogram of derived trust scores (0–100)" loading={l2} error={e2}>
          <TrustHistogram latest={latestWindow} />
        </ChartCard>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <ChartCard title="Rating distribution" subtitle="Star ratings across recorded analyses" loading={l1} error={e1}>
          <BarByKey data={stats ? Object.entries(stats.ratingDistribution).map(([r, c]) => ({ rating: `${r}★`, value: c })) : []}
            xKey="rating" colors={RATING_COLORS} unit=" reviews" showValues />
        </ChartCard>
        <ChartCard title="Sentiment distribution" subtitle="Lexicon-based sentiment (measured signal, not model output)" loading={l1} error={e1}>
          <DonutChart data={stats ? Object.entries(stats.sentimentDistribution).map(([k, v]) => ({ name: k, value: v, color: SENTIMENT_COLORS[k] || SERIES_COLORS[0] })) : []} />
        </ChartCard>
      </div>

      {stats && Object.keys(stats.categoryDistribution || {}).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <ChartCard title="Product category distribution"
            subtitle="Categories recorded with each analysis — records stored before metadata existed show as Uncategorized"
            loading={l1} error={e1}>
            <BarByKey
              data={Object.entries(stats.categoryDistribution).map(([c, n]) => ({ category: c, value: n }))}
              xKey="category" unit=" reviews" horizontal height={Math.max(200, Object.keys(stats.categoryDistribution).length * 32)} />
          </ChartCard>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <CategoryExplorer />
      </div>

      <ChartCard title="Prediction timeline" subtitle="Cumulative analyses in recorded order" loading={l1} error={e1} height={260}>
        <CumulativeHistory />
      </ChartCard>
    </div>
  );
}

/** Section head shared with both layers, so the split is legible at a glance. */
function SectionHead({ index, title, hint }) {
  return (
    <div className="ana-head">
      {index && <span className="ana-head-num" aria-hidden="true">{index}</span>}
      <h2>{title}</h2>
      <span className="ana-rule" aria-hidden="true" />
      {hint && <span className="ana-head-hint">{hint}</span>}
    </div>
  );
}

function Fact({ k, tag, v, tone }) {
  return (
    <div className="fact">
      <div className="fact-k">{k} <span className={tag === 'model' ? 'tag-model' : 'tag-derived'}>{tag}</span></div>
      <div className="fact-v" style={{ color: tone, textTransform: k === 'Risk level' || k === 'Rating' ? 'capitalize' : undefined }}>
        {v}
      </div>
    </div>
  );
}

/** Explore the REAL stored records by product category and verdict. */
function CategoryExplorer() {
  const [category, setCategory] = useState('');
  const [verdict, setVerdict] = useState('');
  // Load once, filter locally: the selectors combine and update immediately.
  const { data: records, loading, error } = useFetch(() => api.history(), []);
  const all = records || [];
  const filtered = filterHistoryRecords(all, { category, verdict });
  const categories = categoryOptions(all);
  const fakeN = filtered.filter((r) => r.prediction === 'fake').length;
  const genuineN = filtered.filter((r) => r.prediction === 'genuine').length;

  return (
    <div className="card">
      <div className="section-head wrap">
        <div>
          <div className="card-title">Category explorer</div>
          <div className="card-sub" style={{ marginBottom: 0 }}>
            Real stored records filtered by product category and model verdict — category is metadata, not a model feature.
          </div>
        </div>
        <div className="filter-row">
          <div className="select-wrap">
            <select className="text-input filter-select" value={category} aria-label="Filter by product category"
              onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.filter((c) => c !== UNCATEGORIZED).map((c) => <option key={c} value={c}>{c}</option>)}
              {categories.includes(UNCATEGORIZED) && <option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>}
            </select>
          </div>
          <div className="select-wrap">
            <select className="text-input filter-select" value={verdict} aria-label="Filter by verdict"
              onChange={(e) => setVerdict(e.target.value)}>
              <option value="">All verdicts</option>
              <option value="fake">Fake</option>
              <option value="genuine">Genuine</option>
            </select>
          </div>
        </div>
      </div>
      {loading && <div className="skeleton" style={{ height: 76 }} />}
      {error && <p className="small" style={{ color: 'var(--fake)' }}>Could not load records: {error.message}</p>}
      {!loading && !error && (
        <div className="explorer-stats">
          <div className="summary-tile"><div className="k">Matching records</div><div className="v">{filtered.length}</div><div className="n">real stored analyses</div></div>
          <div className="summary-tile tone-fake"><div className="k">Predicted fake</div><div className="v">{fakeN}</div><div className="n">model output</div></div>
          <div className="summary-tile tone-genuine"><div className="k">Predicted genuine</div><div className="v">{genuineN}</div><div className="n">model output</div></div>
        </div>
      )}
    </div>
  );
}

function TrustHistogram({ latest }) {
  if (!latest) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center' }} className="faint small">No trust-score data yet — available after model-connected analyses.</div>;
  }
  return <BarByKey data={latest.trustScoreDistribution.map((b) => ({ bucket: b.label, value: b.count }))} xKey="bucket" colors={SERIES_COLORS} />;
}

function CumulativeHistory() {
  const { data: history } = useFetch(() => api.history());
  const data = (history || []).map((h, i) => ({
    label: `#${i + 1}`,
    total: i + 1,
    trust: h.trustScore ?? null
  }));
  // Trust lives on its own 0–100 axis: sharing one scale with a running total
  // would flatten it against the baseline.
  return (
    <TrendLine
      data={data}
      yKeys={[
        { key: 'total', name: 'Cumulative analyses', color: SERIES_COLORS[0] },
        { key: 'trust', name: 'Trust score (derived)', color: SERIES_COLORS[1], axis: 'right' }
      ]}
      height={260}
    />
  );
}
