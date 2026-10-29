import { Link } from 'react-router-dom';
import { useFetch } from '../hooks/useModels.js';
import { api } from '../api/client.js';
import StatCard from '../components/ui/StatCard.jsx';
import StateBlock from '../components/ui/StateBlock.jsx';
import Banner from '../components/ui/Banner.jsx';
import AiOrb from '../components/AiOrb.jsx';
import DonutChart from '../components/charts/DonutChart.jsx';
import TrendLine from '../components/charts/TrendLine.jsx';
import BarByKey from '../components/charts/BarByKey.jsx';
import { CLASS_COLORS, SENTIMENT_COLORS, RATING_COLORS, SERIES_COLORS } from '../components/charts/palette.js';

export default function Dashboard({ modelStatus }) {
  const { data: stats, loading, error, reload } = useFetch(() => api.stats());
  const connected = modelStatus?.connected === true;

  // Binary classifier: exactly two model classes, never a fabricated third.
  const classData = stats ? [
    { name: 'Fake', value: stats.fake, color: CLASS_COLORS.fake },
    { name: 'Genuine', value: stats.genuine, color: CLASS_COLORS.genuine }
  ] : [];

  return (
    <div className="page">
      <section className="hero hud-corners enter">
        <div className="hero-grid">
          <div>
            <div className="hero-eyebrow">Explainable Fake Review Detection</div>
            <h1>Understand Reviews.<br /><span className="grad-text">Detect Deception.</span></h1>
            <p className="hero-sub">
              Investigate review authenticity with hybrid NLP, semantic representations, and stacking-ensemble machine learning.
            </p>
            <div className="hero-actions">
              <Link to="/analyzer" className="btn btn-primary">Analyze a Review</Link>
              <Link to="/research" className="btn btn-secondary">View Research</Link>
            </div>
            <div className="hero-note">
              <span className={`model-badge${connected ? ' connected' : ''}`}>
                <span className="dot" />
                {connected ? 'ML model connected' : 'ML model not connected'}
              </span>
              <span>Hybrid NLP Features + Stacking Ensemble Learning · binary Fake / Genuine classifier</span>
            </div>
          </div>
          <AiOrb />
        </div>
      </section>

      {modelStatus && !connected && (
        <Banner kind="warn" style={{ marginBottom: 22 }}>
          <b>Integration status:</b> the trained model is not connected, so no prediction is produced. Numeric text
          measurements shown in the app are deterministic heuristics — clearly labeled and never presented as
          predictions. See <Link to="/research">Research / About</Link> for the integration plan.
        </Banner>
      )}

      <div className="grid grid-stats enter enter-1" style={{ marginBottom: 22 }}>
        <StatCard
          label="Total Reviews Analyzed"
          value={loading ? '…' : stats?.totalReviews ?? 0}
          hint={stats && stats.totalReviews > 0 ? 'model-connected analyses' : 'analyze your first review'}
          color="var(--accent)"
        />
        <StatCard
          label="Fake Reviews"
          value={loading ? '…' : stats?.fake ?? 0}
          hint="classified fake by the model"
          color={CLASS_COLORS.fake}
        />
        <StatCard
          label="Genuine Reviews"
          value={loading ? '…' : stats?.genuine ?? 0}
          hint="classified genuine by the model"
          color={CLASS_COLORS.genuine}
        />
        <StatCard
          label="Avg Trust Score"
          value={loading ? '…' : stats?.averageTrustScore ?? '—'}
          hint={stats?.averageTrustScore == null ? 'available after analyses' : 'derived from P(fake) · 0–100'}
          color={CLASS_COLORS.genuine}
        />
      </div>

      {error && (
        <StateBlock kind="error" title="Could not reach the API"
          action={<button className="btn btn-primary btn-sm" onClick={reload}>Retry</button>}>
          {error.message} — make sure the backend is running on port 4000.
        </StateBlock>
      )}

      {!error && (
        <>
          <div className="dash-split enter enter-2" style={{ marginBottom: 22 }}>
            <Chart title="Authenticity Distribution" subtitle="Fake vs Genuine — the model's two actual classes" loading={loading}>
              <DonutChart data={classData} centerValue={stats?.totalReviews ?? 0} centerLabel="analyses" />
            </Chart>
            <div className="card enter enter-2">
              <RecentHistory />
            </div>
          </div>

          {stats && Object.keys(stats.categoryDistribution || {}).length > 0 && (
            <div className="enter enter-3" style={{ marginBottom: 22 }}>
              <Chart title="Product Category Distribution"
                subtitle="Real categories recorded with each analysis — reviews stored before metadata existed show as Uncategorized"
                loading={loading}>
                <BarByKey
                  data={Object.entries(stats.categoryDistribution).map(([c, n]) => ({ category: c, value: n }))}
                  xKey="category" unit=" reviews" horizontal />
              </Chart>
            </div>
          )}

          <div className="dash-split-rev enter enter-3" style={{ marginBottom: 22 }}>
            <Chart title="Sentiment Distribution" subtitle="Lexicon-based sentiment (measured signal, not model output)" loading={loading}>
              <DonutChart data={stats ? Object.entries(stats.sentimentDistribution).map(([k, v]) => ({ name: k, value: v, color: SENTIMENT_COLORS[k] || SERIES_COLORS[0] })) : []} />
            </Chart>
            <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 18 }}>
              <Chart title="Rating Distribution" subtitle="Star ratings of analyzed reviews" loading={loading}>
                <BarByKey
                  data={stats ? Object.entries(stats.ratingDistribution).map(([r, c]) => ({ rating: `${r}★`, value: c })) : []}
                  xKey="rating" colors={RATING_COLORS} unit=" reviews" />
              </Chart>
              <Chart title="Prediction History Trend" subtitle="Cumulative model-connected analyses over time" loading={loading}>
                <CumulativeTrend />
              </Chart>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Chart({ title, subtitle, loading, children }) {
  return (
    <div className="card hoverable lit">
      <div className="card-title">{title}</div>
      <div className="card-sub">{subtitle}</div>
      {loading ? <div className="skeleton" style={{ height: 260 }} /> : children}
    </div>
  );
}

function CumulativeTrend() {
  const { data: history } = useFetch(() => api.history());
  const data = (history || []).map((h, i) => ({
    label: `#${i + 1}`,
    total: i + 1,
    fake: h.prediction === 'fake' ? i + 1 : undefined,
    genuine: h.prediction === 'genuine' ? i + 1 : undefined
  }));
  return <TrendLine data={data} yKeys={[{ key: 'total', name: 'Cumulative total', color: SERIES_COLORS[0] }]} />;
}

function RecentHistory() {
  const { data: history, loading, error } = useFetch(() => api.history());
  const recent = (history || []).slice(-5).reverse();

  return (
    <>
      <div className="section-head">
        <h2>Recent Analyses</h2>
        <Link to="/history" className="hint" style={{ color: 'var(--accent)' }}>View full history →</Link>
      </div>
      {loading && <div className="skeleton" style={{ height: 150 }} />}
      {!loading && error && <p className="faint small">Could not load history: {error.message}</p>}
      {!loading && !error && recent.length === 0 && (
        <div className="row" style={{ justifyContent: 'space-between', gap: 16 }}>
          <p className="muted small" style={{ maxWidth: 520 }}>
            No analyses recorded yet. Results you generate in the Review Analyzer appear here with their
            model verdict and probabilities.
          </p>
          <Link to="/analyzer" className="btn btn-primary btn-sm">Analyze a Review</Link>
        </div>
      )}
      {!loading && !error && recent.length > 0 && (
        <div className="recent-list">
          {recent.map((h, i) => (
            <div className="recent-item" key={h.id || i}>
              <span className={`badge badge-${h.prediction}`}>{h.prediction}</span>
              <span className="recent-text" title={h.text}>
                {h.productName && <b className="recent-product">{h.productName} — </b>}
                {h.text}
              </span>
              <span className="chip cat small-chip">{h.productCategory || 'Uncategorized'}</span>
              <span className="recent-meta">{h.rating}★ · trust {h.trustScore ?? '—'}</span>
              <span className="recent-meta">{h.analyzedAt ? new Date(h.analyzedAt).toLocaleString() : ''}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
