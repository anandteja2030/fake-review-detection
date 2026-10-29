import { useState } from 'react';
import { useFetch } from '../hooks/useModels.js';
import { api } from '../api/client.js';
import StatCard from '../components/ui/StatCard.jsx';
import StateBlock from '../components/ui/StateBlock.jsx';
import Banner from '../components/ui/Banner.jsx';
import ChartCard from '../components/ui/ChartCard.jsx';
import DonutChart from '../components/charts/DonutChart.jsx';
import BarByKey from '../components/charts/BarByKey.jsx';
import TrendLine from '../components/charts/TrendLine.jsx';
import { CLASS_COLORS, SENTIMENT_COLORS, RATING_COLORS, SERIES_COLORS } from '../components/charts/palette.js';

export default function Analytics() {
  const { data: stats, loading: l1, error: e1, reload } = useFetch(() => api.stats());
  const { data: latest, loading: l2, error: e2 } = useFetch(() => api.metricsLatest());
  const hasHistory = stats && stats.totalReviews > 0;

  return (
    <div className="page">
      <div className="page-header enter">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <h1>Analytics</h1>
          <span className="provenance-chip live">Live usage data</span>
        </div>
        <p>
          Aggregate insights computed from real recorded analyses in this deployment — nothing here is simulated.
          Empty charts simply mean no model-connected analyses have been recorded yet.
        </p>
      </div>

      {!hasHistory && !l1 && !e1 && (
        <div style={{ marginBottom: 20 }}>
          <Banner kind="info">
            <b>No analyses recorded yet.</b> Once reviews are analyzed with the connected model, this page fills
            with prediction, trust-score, rating and sentiment distributions computed from your actual usage.
          </Banner>
        </div>
      )}

      {e1 && <StateBlock kind="error" title="Could not load analytics" action={<button className="btn btn-primary btn-sm" onClick={reload}>Retry</button>}>{e1.message}</StateBlock>}

      <div className="grid grid-stats enter enter-1" style={{ marginBottom: 22 }}>
        <StatCard label="Total Analyses" value={l1 ? '…' : stats?.totalReviews ?? 0} color="var(--accent)" />
        <StatCard label="Fake" value={l1 ? '…' : stats?.fake ?? 0} hint="model verdict" color={CLASS_COLORS.fake} />
        <StatCard label="Genuine" value={l1 ? '…' : stats?.genuine ?? 0} hint="model verdict" color={CLASS_COLORS.genuine} />
        <StatCard label="Avg Trust Score" value={l1 ? '…' : stats?.averageTrustScore ?? '—'} hint="derived from P(fake)" color={CLASS_COLORS.genuine} />
      </div>

      <div className="dash-split" style={{ marginBottom: 22 }}>
        <ChartCard title="Authenticity Distribution" subtitle="Fake vs Genuine — the model's two actual classes" loading={l1} error={e1}>
          <DonutChart
            data={stats ? [
              { name: 'Fake', value: stats.fake, color: CLASS_COLORS.fake },
              { name: 'Genuine', value: stats.genuine, color: CLASS_COLORS.genuine }
            ] : []}
            centerValue={stats?.totalReviews ?? 0} centerLabel="analyses" />
        </ChartCard>
        <ChartCard title="Trust Score Distribution" subtitle="Histogram of derived trust scores (0–100)" loading={l2} error={e2}>
          <TrustHistogram latest={latest} />
        </ChartCard>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 22 }}>
        <ChartCard title="Rating Distribution" subtitle="Star ratings across recorded analyses" loading={l1} error={e1}>
          <BarByKey data={stats ? Object.entries(stats.ratingDistribution).map(([r, c]) => ({ rating: `${r}★`, value: c })) : []}
            xKey="rating" colors={RATING_COLORS} unit=" reviews" />
        </ChartCard>
        <ChartCard title="Sentiment Distribution" subtitle="Lexicon-based sentiment (measured signal, not model output)" loading={l1} error={e1}>
          <DonutChart data={stats ? Object.entries(stats.sentimentDistribution).map(([k, v]) => ({ name: k, value: v, color: SENTIMENT_COLORS[k] || SERIES_COLORS[0] })) : []} />
        </ChartCard>
      </div>

      {stats && Object.keys(stats.categoryDistribution || {}).length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <ChartCard title="Product Category Distribution"
            subtitle="Categories recorded with each analysis — records stored before metadata existed show as Uncategorized"
            loading={l1} error={e1}>
            <BarByKey
              data={Object.entries(stats.categoryDistribution).map(([c, n]) => ({ category: c, value: n }))}
              xKey="category" unit=" reviews" horizontal height={Math.max(220, Object.keys(stats.categoryDistribution).length * 34)} />
          </ChartCard>
        </div>
      )}

      <div style={{ marginBottom: 22 }}>
        <CategoryExplorer />
      </div>

      <ChartCard title="Prediction History" subtitle="Cumulative analyses in recorded order" loading={l1} error={e1} height={280}>
        <CumulativeHistory />
      </ChartCard>
    </div>
  );
}

/** Explore the REAL stored records by product category and verdict. */
function CategoryExplorer() {
  const { data: catData } = useFetch(() => api.categories());
  const [category, setCategory] = useState('');
  const [verdict, setVerdict] = useState('');
  const { data: records, loading, error } = useFetch(() => api.history({ category, verdict }));
  const filtered = records || [];
  const fakeN = filtered.filter((r) => r.prediction === 'fake').length;
  const genuineN = filtered.filter((r) => r.prediction === 'genuine').length;

  return (
    <div className="card">
      <div className="section-head wrap">
        <div>
          <div className="card-title">Category Explorer</div>
          <div className="card-sub" style={{ marginBottom: 0 }}>
            Real stored records filtered by product category and model verdict — category is metadata, not a model feature.
          </div>
        </div>
        <div className="filter-row">
          <select className="text-input filter-select" value={category} aria-label="Filter by product category"
            onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(catData?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="Uncategorized">Uncategorized</option>
          </select>
          <select className="text-input filter-select" value={verdict} aria-label="Filter by verdict"
            onChange={(e) => setVerdict(e.target.value)}>
            <option value="">All verdicts</option>
            <option value="fake">Fake</option>
            <option value="genuine">Genuine</option>
          </select>
        </div>
      </div>
      {loading && <div className="skeleton" style={{ height: 90 }} />}
      {error && <p className="small" style={{ color: 'var(--fake)' }}>Could not load records: {error.message}</p>}
      {!loading && !error && (
        <div className="explorer-stats">
          <div className="summary-tile"><div className="k">Matching records</div><div className="v">{filtered.length}</div><div className="n">real stored analyses</div></div>
          <div className="summary-tile tone-fake"><div className="k">Predicted Fake</div><div className="v">{fakeN}</div><div className="n">model output</div></div>
          <div className="summary-tile tone-genuine"><div className="k">Predicted Genuine</div><div className="v">{genuineN}</div><div className="n">model output</div></div>
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
  return <TrendLine data={data} yKeys={[{ key: 'total', name: 'Cumulative analyses', color: SERIES_COLORS[0] }, { key: 'trust', name: 'Trust score (derived)', color: SERIES_COLORS[1] }]} />;
}
