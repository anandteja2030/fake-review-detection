import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../hooks/useModels.js';
import { api } from '../api/client.js';
import StateBlock from '../components/ui/StateBlock.jsx';
import Banner from '../components/ui/Banner.jsx';
import NeuralCore from '../components/hero/NeuralCore.jsx';
import QuickAnalysis from '../components/QuickAnalysis.jsx';
import DonutChart from '../components/charts/DonutChart.jsx';
import TrendLine from '../components/charts/TrendLine.jsx';
import BarByKey from '../components/charts/BarByKey.jsx';
import { CLASS_COLORS, SENTIMENT_COLORS, RATING_COLORS, SERIES_COLORS } from '../components/charts/palette.js';
import { useCountUp } from '../hooks/useCountUp.js';
import {
  IconActivity, IconAlertOctagon, IconThumbsUp, IconTarget,
  IconArrowRight, IconBrain, IconLayers, IconSpark
} from '../components/layout/Icons.jsx';

export default function Dashboard({ modelStatus }) {
  const { data: stats, loading, error, reload } = useFetch(() => api.stats());
  const connected = modelStatus?.connected === true;
  const classes = modelStatus?.expectedModelInfo?.classes;
  const classLabel = classes?.length ? classes.join(' / ') : 'fake / genuine';
  const stageRef = useRef(null);

  // Pointer parallax: the floating HUD layers drift at different depths.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const huds = Array.from(el.querySelectorAll('.hud'));
    let raf = 0;
    const onMove = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        huds.forEach((h, i) => {
          const depth = (i + 1) * 8;
          h.style.setProperty('--hx', (nx * depth).toFixed(1));
          h.style.setProperty('--hy', (ny * depth).toFixed(1));
        });
      });
    };
    const onLeave = () => huds.forEach((h) => {
      h.style.setProperty('--hx', 0);
      h.style.setProperty('--hy', 0);
    });
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Binary classifier: exactly two model classes, never a fabricated third.
  const classData = stats ? [
    { name: 'Fake', value: stats.fake, color: CLASS_COLORS.fake },
    { name: 'Genuine', value: stats.genuine, color: CLASS_COLORS.genuine }
  ] : [];

  return (
    <div className="page dash-page">
      <section className="cine-hero">
        <span className="cine-aurora" aria-hidden="true" />
        <span className="cine-scan" aria-hidden="true" />

        <div className="cine-inner">
          <div className="cine-copy">
            <span className="cine-eyebrow">
              <i className="pulse" aria-hidden="true" />
              Explainable AI · research workstation
            </span>
            <h1 className="cine-title">
              Trust the signal.
              <span className="cine-title-grad">Detect the deception.</span>
            </h1>
            <p className="cine-lead">
              Word and character TF-IDF, Sentence-BERT embeddings and nine measured text signals feed a
              <b> three-model stacking ensemble</b>. Every verdict arrives with real probabilities, term-ablation
              evidence, and an honest account of what the model cannot prove.
            </p>
            <div className="cine-actions">
              <Link to="/analyzer" className="cine-btn primary">
                Analyze a review <IconArrowRight />
              </Link>
              <Link to="/analytics" className="cine-btn ghost">Explore intelligence</Link>
            </div>
            <div className="cine-spec">
              <span><em>features</em> word + char TF-IDF · SBERT · 9 signals</span>
              <span><em>ensemble</em> LR · XGBoost · LightGBM → LR meta</span>
              <span><em>classes</em> {classLabel}</span>
            </div>
          </div>
        </div>

        <div className="cine-core" ref={stageRef}>
          <NeuralCore connected={connected} />
          <div className="hud hud-status">
            <span className="hud-k">Inference service</span>
            <span className="hud-v"><span className={`dot${connected ? ' on' : ''}`} />{modelStatus ? (connected ? 'Online' : 'Offline') : 'Checking…'}</span>
            <span className="hud-k dim">{modelStatus?.adapterMode ?? '—'}</span>
          </div>
          <div className="hud hud-classes">
            <span className="hud-k">Model classes</span>
            <span className="hud-v mono">{classLabel}</span>
          </div>
          <div className="hud hud-total">
            <span className="hud-k">Analyses recorded</span>
            <span className="hud-big">{loading ? '—' : stats?.totalReviews ?? 0}</span>
            <span className="hud-k dim">{stats?.averageTrustScore != null ? `avg trust ${stats.averageTrustScore}` : 'no trust data yet'}</span>
          </div>
          <div className="hud hud-path">
            <span className="hud-k">Inference path</span>
            <span className="hud-v mono">browser → express → fastapi</span>
          </div>
          <span className="cine-floor" aria-hidden="true" />
        </div>

        <div className="cine-scroll" aria-hidden="true">
          <span className="cine-scroll-line" />
          scroll · intelligence
        </div>
      </section>

      <div className="dash-wrap">
        <section className="metric-deck" aria-label="Live project metrics">
          <MetricTile
            icon={IconActivity} tone="var(--accent)"
            k="Reviews analyzed" value={loading ? null : stats?.totalReviews ?? 0}
            hint="recorded in prediction history"
          />
          <MetricTile
            icon={IconAlertOctagon} tone="var(--fake)"
            k="Predicted fake" value={loading ? null : stats?.fake ?? 0}
            hint="model verdict · not a verified truth label"
          />
          <MetricTile
            icon={IconThumbsUp} tone="var(--genuine)"
            k="Predicted genuine" value={loading ? null : stats?.genuine ?? 0}
            hint="model verdict · not a verified truth label"
          />
          <MetricTile
            icon={IconTarget} tone="var(--accent-blue)"
            k="Average trust" value={loading ? null : stats?.averageTrustScore} unit="/100"
            hint="100 − P(fake)·100 — derived, not trained"
          />
        </section>

        {modelStatus && !connected && (
          <div className="dash-banner">
            <Banner kind="warn">
              <b>Inference service offline.</b> The trained model is not connected, so no prediction is produced.
              Numeric text measurements shown in the app are deterministic heuristics — clearly labelled and never
              presented as predictions. See <Link to="/research">Research / About</Link> for the integration contract.
            </Banner>
          </div>
        )}

        {error && (
          <div className="dash-banner">
            <StateBlock kind="error" title="Could not reach the API"
              action={<button className="btn btn-primary btn-sm" onClick={reload}>Retry</button>}>
              {error.message} — make sure the backend is running on port 4000.
            </StateBlock>
          </div>
        )}

        {!error && (
          <>
            <section className="cockpit enter enter-1">
              <div className="cockpit-main">
                <div className="panel-chrome">
                  <span className="chrome-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span className="chrome-title">analysis console</span>
                  <span className="chrome-meta">POST /api/analyze</span>
                </div>
                <QuickAnalysis connected={connected} />
              </div>

              <div className="gp runtime-panel">
                <PanelHead
                  index="01" title="Model &amp; runtime" sub="Reported by the Express API, not inferred in the browser"
                  aside={(
                    <span className={`model-badge${connected ? ' connected' : ''}`}>
                      <span className="dot" />
                      {connected ? 'Connected' : 'Offline'}
                    </span>
                  )}
                />
                <div className="runtime-list">
                  <RuntimeRow k="Adapter" v={modelStatus?.adapterMode ?? '—'} />
                  <RuntimeRow k="Interface" v={modelStatus?.integration ?? '—'} />
                  <RuntimeRow k="Class set" v={classLabel} />
                  <RuntimeRow k="Base learners" v="LR · XGB · LGBM" />
                  <RuntimeRow k="Meta-model" v="Logistic Regression" />
                </div>
                <Link to="/model-performance" className="btn btn-secondary btn-sm btn-block runtime-link">
                  <IconLayers /> Model performance
                </Link>
              </div>
            </section>

            <section className="gp activity-panel enter enter-2">
              <PanelHead
                index="02" title="Recent activity" sub="The five latest verdicts written to prediction history"
                aside={<Link to="/history" className="micro-link">All predictions →</Link>}
              />
              <RecentHistory />
            </section>

            <div className="dash-section-head enter enter-2">
              <span className="dash-section-index">03</span>
              <h2>Signal intelligence</h2>
              <span className="dash-section-rule" aria-hidden="true" />
              <span className="dash-section-note">every figure below is computed from recorded analyses</span>
            </div>

            <section className="bento enter enter-2">
              <Panel className="span-4" title="Authenticity distribution" sub="Fake vs Genuine — the model's two actual classes" loading={loading} numeric="04a">
                <DonutChart data={classData} centerValue={stats?.totalReviews ?? 0} centerLabel="analyses" height={244} />
              </Panel>

              <Panel className="span-4" title="Sentiment distribution" sub="Lexicon signal — measured, not model output" loading={loading} numeric="04b">
                <DonutChart
                  data={stats ? Object.entries(stats.sentimentDistribution).map(([k, v]) => ({
                    name: k, value: v, color: SENTIMENT_COLORS[k] || SERIES_COLORS[0]
                  })) : []}
                  centerValue={stats?.totalReviews ?? 0}
                  centerLabel="analyses"
                  height={244}
                />
              </Panel>

              <Panel className="span-4" title="Rating distribution" sub="Star ratings of analyzed reviews" loading={loading} numeric="04c">
                <BarByKey
                  data={stats ? Object.entries(stats.ratingDistribution).map(([r, c]) => ({ rating: `${r}★`, value: c })) : []}
                  xKey="rating" colors={RATING_COLORS} unit=" reviews" height={244} showValues
                />
              </Panel>

              <Panel className="span-7" title="Analysis trend" sub="Cumulative model-connected analyses over time" loading={loading} numeric="04d">
                <CumulativeTrend />
              </Panel>

              <Panel className="span-5" title="Product category distribution" sub="Categories recorded with each analysis — older records show as Uncategorized" loading={loading} numeric="04e">
                {stats && Object.keys(stats.categoryDistribution || {}).length > 0 ? (
                  <BarByKey
                    data={Object.entries(stats.categoryDistribution).map(([c, n]) => ({ category: c, value: n }))}
                    xKey="category" unit=" reviews" horizontal
                    height={Math.max(220, Object.keys(stats.categoryDistribution).length * 36)}
                  />
                ) : (
                  <div className="panel-empty">No categorised analyses yet.</div>
                )}
              </Panel>

              <div className="gp xai-cta span-12">
                <div className="xai-cta-glow" aria-hidden="true" />
                <span className="xai-cta-glyph"><IconBrain /></span>
                <div className="xai-cta-copy">
                  <h3>Explainability is part of the product</h3>
                  <p>
                    Every verdict ships with measured signals, term-ablation attribution and an honest statement of what
                    the model cannot establish. Open a prediction to inspect its evidence chain.
                  </p>
                </div>
                <Link to="/explainability" className="btn btn-secondary btn-sm">
                  Open Explainable AI <IconArrowRight />
                </Link>
              </div>
            </section>

            <div className="dash-footnote">
              <IconSpark />
              <span>
                Numeric trust and risk values are derived from the model's probability output, not separate trained
                heads. Verdicts describe the model's output, not ground truth.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MetricTile({ icon: Icon, tone, k, value, unit, hint }) {
  const animated = useCountUp(typeof value === 'number' ? value : null);
  const shown = typeof value === 'number' && animated != null
    ? (Number.isInteger(value) ? Math.round(animated) : animated.toFixed(1))
    : (value ?? '—');
  return (
    <div className="deck-tile" style={{ '--c': tone }}>
      <span className="deck-icon"><Icon /></span>
      <div className="deck-body">
        <span className="deck-k">{k}</span>
        <span className="deck-v">{shown}{unit && <small>{unit}</small>}</span>
        <span className="deck-hint">{hint}</span>
      </div>
      <span className="deck-corner" aria-hidden="true" />
    </div>
  );
}

function RuntimeRow({ k, v }) {
  return (
    <div className="runtime-row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function PanelHead({ index, title, sub, aside }) {
  return (
    <div className="panel-head">
      <span className="panel-index">{index}</span>
      <div className="panel-head-copy">
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

function Panel({ title, sub, loading, children, className = '', numeric }) {
  return (
    <div className={`gp panel ${className}`}>
      <div className="panel-head">
        {numeric && <span className="panel-index">{numeric}</span>}
        <div className="panel-head-copy">
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
      </div>
      <div className="panel-body">
        {loading ? <div className="skeleton" style={{ height: 220 }} /> : children}
      </div>
    </div>
  );
}

function CumulativeTrend() {
  const { data: history } = useFetch(() => api.history());
  const data = (history || []).map((h, i) => ({
    label: `#${i + 1}`,
    total: i + 1
  }));
  return <TrendLine data={data} yKeys={[{ key: 'total', name: 'Cumulative total', color: SERIES_COLORS[0] }]} height={252} />;
}

function RecentHistory() {
  const { data: history, loading, error } = useFetch(() => api.history());
  const recent = (history || []).slice(-5).reverse();

  return (
    <div className="activity-body">
      {loading && <div className="skeleton" style={{ height: 150, marginTop: 10 }} />}
      {!loading && error && <p className="faint small" style={{ marginTop: 10 }}>Could not load history: {error.message}</p>}
      {!loading && !error && recent.length === 0 && (
        <>
          <p className="muted small" style={{ marginTop: 10, maxWidth: 420 }}>
            No analyses recorded yet. Results you generate above or in the Review Analyzer appear here with their
            verdict and probabilities.
          </p>
          <Link to="/analyzer" className="btn btn-secondary btn-sm" style={{ marginTop: 12, alignSelf: 'flex-start' }}>
            Open Review Analyzer
          </Link>
        </>
      )}
      {!loading && !error && recent.length > 0 && (
        <div className="activity-list">
          {recent.map((h, i) => (
            <div className="activity-row" key={h.id || i}>
              <span className={`badge badge-${h.prediction}`}>{h.prediction}</span>
              <span className="activity-text" title={h.text}>
                {h.productName && <b>{h.productName} — </b>}
                {h.text}
              </span>
              <span className="activity-meta">{h.rating}★ · trust {h.trustScore ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
