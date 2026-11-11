import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useFetch } from '../hooks/useModels.js';
import { api } from '../api/client.js';
import StateBlock from '../components/ui/StateBlock.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import ChartCard from '../components/ui/ChartCard.jsx';
import ChartTooltip from '../components/charts/ChartTooltip.jsx';

const METRIC_DEFS = [
  { key: 'accuracy', label: 'Accuracy', color: 'var(--accent)', desc: 'Share of all test reviews classified correctly.' },
  { key: 'precision', label: 'Precision', color: 'var(--accent-blue)', desc: 'Of reviews flagged fake, the share that were actually fake.' },
  { key: 'recall', label: 'Recall', color: 'var(--genuine)', desc: 'Of the actual fake reviews, the share the model caught.' },
  { key: 'f1Score', label: 'F1 score', color: 'var(--amber)', desc: 'Harmonic mean of precision and recall.' },
  { key: 'rocAuc', label: 'ROC-AUC', color: 'var(--accent-2)', desc: 'Ranking quality across all decision thresholds.' }
];

/**
 * Independent audit run on 2026-11-01 against the saved artifacts.
 * Source: docs/audit-2026-11-01.md, ml/audit_dataset_eval.py.
 * Corpus: Ott et al. Deceptive Opinion Spam, 1,600 balanced reviews.
 */
const AUDIT = {
  date: '2026-11-01',
  corpus: 'Ott et al. Deceptive Opinion Spam (Chicago hotel reviews)',
  n: 1600,
  deceptive: 800,
  truthful: 800,
  accuracy: 0.5,
  precision: 0,
  recall: 0,
  f1: 0,
  rocAuc: 0.549,
  prAuc: 0.537,
  brier: 0.488,
  cm: { TN: 800, FP: 0, FN: 800, TP: 0 },
  predictedGenuine: 1598,
  baseLearners: [
    { name: 'Logistic Regression', auc: 0.515 },
    { name: 'XGBoost (calibrated)', auc: 0.575 },
    { name: 'LightGBM', auc: 0.575 }
  ],
  caveat: 'The repository contains no training data or split indices, so it cannot be proven whether this corpus is in- or out-of-distribution for the saved model. Treat this as a generalisation stress test, not a replacement for a documented held-out split.'
};

export default function ModelPerformance() {
  const { data: m, loading, error } = useFetch(() => api.modelReport());

  if (loading) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 90, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 240 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <StateBlock kind="error" title="Could not load model report">{error.message}</StateBlock>
      </div>
    );
  }

  const cm = m.confusionMatrix;
  const total = (cm.TN || 0) + (cm.FP || 0) + (cm.FN || 0) + (cm.TP || 0);
  const auditCm = AUDIT.cm;
  const auditTotal = auditCm.TN + auditCm.FP + auditCm.FN + auditCm.TP;

  return (
    <div className="page">
      <PageHeader
        index="05"
        eyebrow="Evaluation console"
        title={<>Model <span className="grad-text">performance</span></>}
        description="Two separate evidence sources: the metrics reported by the project author, and an independent audit of the saved artifacts. They are never mixed or averaged."
        meta={[
          { k: 'Reported acc.', v: `${m.accuracy}%`, tone: 'accent' },
          { k: 'Audit ROC-AUC', v: AUDIT.rocAuc.toFixed(3), tone: 'fake' },
          { k: 'Audit n', v: AUDIT.n }
        ]}
      />

      <div className="dash-split" style={{ marginBottom: 16 }}>
        <div className="glass-card enter enter-1">
          <div className="spread" style={{ marginBottom: 14 }}>
            <div>
              <div className="deck-title">Reported metrics <span className="tag-model">author-provided</span></div>
              <div className="card-sub" style={{ marginBottom: 0 }}>
                Stored in <code>model_metrics.json</code> exactly as supplied. This application does not recompute them.
              </div>
            </div>
            <span className="chip">{total} test reviews</span>
          </div>
          <div className="gauge-row">
            {METRIC_DEFS.map((def) => (
              <Gauge key={def.key} label={def.label} value={m[def.key]} color={def.color} />
            ))}
          </div>
          <div className="chart-legend" style={{ marginTop: 12 }}>
            Filed under provenance <b>user-provided</b> · not verified by this deployment.
          </div>
        </div>

        <div className="glass-card verify-card enter enter-1">
          <div className="spread" style={{ marginBottom: 10 }}>
            <div>
              <div className="deck-title">Independent audit <span className="flip-badge">measured</span></div>
              <div className="card-sub" style={{ marginBottom: 0 }}>
                {AUDIT.date} · {AUDIT.n} externally labelled reviews, {AUDIT.deceptive} deceptive / {AUDIT.truthful} truthful.
              </div>
            </div>
          </div>

          <div className="ev-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
            <AuditMetric k="Accuracy" v={AUDIT.accuracy.toFixed(3)} />
            <AuditMetric k="ROC-AUC" v={AUDIT.rocAuc.toFixed(3)} />
            <AuditMetric k="PR-AUC" v={AUDIT.prAuc.toFixed(3)} />
            <AuditMetric k="Brier" v={AUDIT.brier.toFixed(3)} />
            <AuditMetric k="Precision" v={AUDIT.precision.toFixed(3)} />
            <AuditMetric k="Recall" v={AUDIT.recall.toFixed(3)} />
          </div>

          <p className="small muted" style={{ marginTop: 12 }}>
            <b>{AUDIT.predictedGenuine} of {AUDIT.n}</b> reviews were classified Genuine. On this corpus the ensemble
            performs at chance level, so the reported metrics could not be reproduced.
          </p>

          <div className="abl-note" style={{ marginTop: 8 }}>
            <span>base learners · ROC-AUC</span>
            <span className="mono">
              {AUDIT.baseLearners.map((b) => `${b.name.split(' ')[0]} ${b.auc.toFixed(3)}`).join(' · ')}
            </span>
          </div>
          <p className="faint small" style={{ marginTop: 10 }}>{AUDIT.caveat}</p>
        </div>
      </div>

      <div style={{ marginBottom: 16 }} className="enter enter-2">
        <ChartCard
          title="Reported vs independent audit"
          subtitle="The same metrics from two separate evidence sources, plotted side by side — never averaged, never merged"
          badge="two sources"
          height={272}
          footnote={<>The width of each gap is the finding. <b>Reported</b> values are stored as supplied by the author; <b>audit</b> values were measured on 1,600 externally labelled reviews. Neither series is adjusted to bring them closer.</>}
        >
          <SourceComparison report={m} />
        </ChartCard>
      </div>

      <div className="dash-split" style={{ marginBottom: 16 }}>
        <div className="glass-card enter enter-2">
          <div className="deck-title">Reported confusion matrix</div>
          <div className="card-sub">
            {total > 0 ? `${total} evaluated reviews · ` : ''}Fake is the positive class in the original evaluation.
          </div>
          <div className="cm">
            <div className="cm-corner" />
            <div className="cm-axis-x">Predicted genuine</div>
            <div className="cm-axis-x">Predicted fake</div>
            <div className="cm-axis-y">Actual negative</div>
            <CMCell label="TN" value={cm.TN} tone="good" />
            <CMCell label="FP" value={cm.FP} tone="bad" />
            <div className="cm-axis-y">Actual positive</div>
            <CMCell label="FN" value={cm.FN} tone="bad" />
            <CMCell label="TP" value={cm.TP} tone="good" />
          </div>
          <p className="faint small" style={{ marginTop: 12 }}>
            Author-reported counts. They cannot be reconciled with the audit results in the adjacent panel.
          </p>
        </div>

        <div className="glass-card enter enter-2">
          <div className="deck-title">Audit confusion matrix</div>
          <div className="card-sub">
            {auditTotal} reviews · Fake positive · produced by this audit, not by the project author.
          </div>
          <div className="cm">
            <div className="cm-corner" />
            <div className="cm-axis-x">Predicted genuine</div>
            <div className="cm-axis-x">Predicted fake</div>
            <div className="cm-axis-y">Actual truthful</div>
            <CMCell label="TN" value={auditCm.TN} tone="good" />
            <CMCell label="FP" value={auditCm.FP} tone="bad" />
            <div className="cm-axis-y">Actual deceptive</div>
            <CMCell label="FN" value={auditCm.FN} tone="bad" />
            <CMCell label="TP" value={auditCm.TP} tone="good" />
          </div>
          <p className="faint small" style={{ marginTop: 12 }}>
            Zero fake-positive predictions: the threshold was never crossed on this corpus.
          </p>
        </div>
      </div>

      <div className="dash-split" style={{ marginBottom: 16 }}>
        <div className="glass-card enter enter-3">
          <div className="deck-title">Configuration</div>
          <div className="card-sub">How the saved inference pipeline is assembled.</div>
          <div className="stack" style={{ gap: 8 }}>
            <ConfigRow k="Classifier" v="Stacking ensemble" />
            <ConfigRow k="Base learners" v="Logistic Regression · XGBoost · LightGBM" />
            <ConfigRow k="Meta-model" v="Logistic Regression over base probabilities" />
            <ConfigRow k="Feature space" v="Word TF-IDF · char TF-IDF · Sentence-BERT · 9 manual features" />
            <ConfigRow k="Decision threshold" v="0.47375 (saved with the artifacts)" />
            <ConfigRow k="Classes" v="fake · genuine (binary — no suspicious class)" />
            <ConfigRow k="Calibration" v="XGBoost wrapped in CalibratedClassifierCV; meta-model uncalibrated" />
          </div>
        </div>

        <div className="glass-card enter enter-3">
          <div className="deck-title">What is not shown — and why</div>
          <div className="card-sub">Charts appear only when the data behind them exists.</div>
          <ul className="limitations" style={{ gap: 8 }}>
            <li><b>No ROC curve:</b> the stored report contains a single AUC value, not the per-threshold points a curve requires. It is not reconstructed.</li>
            <li><b>No threshold sweep:</b> the saved threshold is a single scalar; no sweep data was supplied.</li>
            <li><b>No live accuracy:</b> predictions recorded in this deployment have no verified ground-truth labels, so they cannot be scored.</li>
            <li><b>Reported metrics:</b> displayed as supplied, with provenance <code>user-provided</code>.</li>
          </ul>
        </div>
      </div>

      <div className="glass-card enter enter-3">
        <div className="deck-title">Why the two panels disagree</div>
        <div className="card-sub">The audit identified three measured causes — no artifact was modified.</div>
        <ul className="limitations" style={{ gap: 8 }}>
          <li><b>Near-constant scaler feature:</b> <code>short_flag</code> had scale 0.019 in training, so a short review is amplified ~52× and contributes +8.8 logit — short texts are near-deterministically Fake.</li>
          <li><b>Promotional vocabulary is almost ignored:</b> the <code>promo_score</code> weight is 0.011 per SD, so six matches change the logit by only ~0.08.</li>
          <li><b>No measurable generalisation on the audit corpus:</b> all three base learners scored ROC-AUC 0.515–0.575, and 24 feature-block orderings peaked at 0.540.</li>
        </ul>
        <p className="faint small" style={{ marginTop: 10 }}>
          Full method and limitations: <code>docs/audit-2026-11-01.md</code>. The saved artifacts remain untouched;
          replacing them requires a documented retrain and your approval.
        </p>
      </div>
    </div>
  );
}

/**
 * Grouped bars for the two evidence sources.
 * Reported metrics are stored as percentages; the audit reports 0–1, so the
 * audit is scaled to percent for a shared axis. Display only — no value is
 * altered at its source.
 */
function SourceComparison({ report }) {
  const rows = [
    { metric: 'Accuracy', reported: Number(report.accuracy), audit: AUDIT.accuracy * 100 },
    { metric: 'Precision', reported: Number(report.precision), audit: AUDIT.precision * 100 },
    { metric: 'Recall', reported: Number(report.recall), audit: AUDIT.recall * 100 },
    { metric: 'F1', reported: Number(report.f1Score), audit: AUDIT.f1 * 100 },
    { metric: 'ROC-AUC', reported: Number(report.rocAuc), audit: AUDIT.rocAuc * 100 }
  ];

  return (
    <div className="cmp-wrap">
      <div className="cmp-plot">
        <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 14, right: 12, left: -14, bottom: 0 }} barCategoryGap="24%" barGap={5}>
          <defs>
            <linearGradient id="cmp-reported" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.95} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.3} />
            </linearGradient>
            <linearGradient id="cmp-audit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--fake)" stopOpacity={0.95} />
              <stop offset="100%" stopColor="var(--fake)" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="metric" tick={{ fontSize: 11.5, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--chart-grid)' }} tickLine={false} tickMargin={7} interval={0} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 11.5, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} tickMargin={4} width={40} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={<ChartTooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />} cursor={{ fill: 'var(--accent-soft)', radius: 8 }} />
          <Bar dataKey="reported" name="Reported (author)" fill="url(#cmp-reported)" radius={[7, 7, 0, 0]} maxBarSize={34}
            isAnimationActive={false} />
          <Bar dataKey="audit" name="Audit (this deployment)" fill="url(#cmp-audit)" radius={[7, 7, 0, 0]} maxBarSize={34}
            isAnimationActive={false} />
        </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-source-key">
        <span><i className="k-reported" />Reported · author-provided</span>
        <span><i className="k-audit" />Audit · measured {AUDIT.date}</span>
        <span className="faint">0% and 100% are the axis limits, not observed values.</span>
      </div>
    </div>
  );
}

function AuditMetric({ k, v }) {
  return (
    <div className="fact" style={{ padding: '8px 10px' }}>
      <div className="fact-k">{k}</div>
      <div className="fact-v" style={{ fontSize: 20 }}>{v}</div>
    </div>
  );
}

function Gauge({ label, value, color }) {
  const p = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 30;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p / 100);
  return (
    <div className="gauge" style={{ '--gauge-color': color }}>
      <div className="gauge-metric">
        <svg viewBox="0 0 74 74" role="img" aria-label={`${label}: ${p}%`}>
          <circle className="gauge-track" cx="37" cy="37" r={r} fill="none" strokeWidth="6" />
          <circle className="gauge-fill" cx="37" cy="37" r={r} fill="none" strokeWidth="6"
            strokeDasharray={c} strokeDashoffset={offset} />
        </svg>
        <span className="gauge-number">{p}%</span>
      </div>
      <div className="gauge-label">{label}</div>
    </div>
  );
}

function CMCell({ label, value, tone }) {
  return (
    <div className={`cm-cell ${tone}`}>
      <div className="cm-k">{label}</div>
      <div className="cm-v">{value}</div>
    </div>
  );
}

function ConfigRow({ k, v }) {
  return (
    <div className="core-row" style={{ alignItems: 'flex-start' }}>
      <span className="core-k" style={{ flexShrink: 0 }}>{k}</span>
      <span className="core-v" style={{ maxWidth: '64%', whiteSpace: 'normal', lineHeight: 1.45 }}>{v}</span>
    </div>
  );
}
