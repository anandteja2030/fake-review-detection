import { useFetch } from '../hooks/useModels.js';
import { api } from '../api/client.js';
import StatCard from '../components/ui/StatCard.jsx';
import Banner from '../components/ui/Banner.jsx';
import StateBlock from '../components/ui/StateBlock.jsx';

export default function ModelPerformance() {
  const { data: m, loading, error } = useFetch(() => api.modelReport());

  if (loading) return <div className="page"><div className="skeleton" style={{ height: 320 }} /></div>;
  if (error) return <div className="page"><StateBlock kind="error" title="Could not load model report">{error.message}</StateBlock></div>;

  const cm = m.confusionMatrix;

  return (
    <div className="page">
      <div className="page-header enter">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <h1>Model Performance</h1>
          <span className="provenance-chip">Offline test set · author-reported</span>
        </div>
        <p>
          Evaluation results from the project author's existing ML project, stored and displayed exactly as
          provided. These are <b>offline held-out test metrics</b> — this application does not recompute,
          verify, or fabricate them, and they are separate from the live usage statistics on the
          Dashboard and Analytics pages.
        </p>
      </div>

      <Banner kind="warn" style={{ marginBottom: 20 }}>
        <b>Provenance:</b> {m.note}
      </Banner>

      <div className="grid grid-stats enter enter-1" style={{ marginBottom: 22 }}>
        <StatCard label="Accuracy" value={`${m.accuracy}%`} color="var(--accent)" />
        <StatCard label="Precision" value={`${m.precision}%`} color="var(--accent-2)" />
        <StatCard label="Recall" value={`${m.recall}%`} color="var(--genuine)" />
        <StatCard label="F1 Score" value={`${m.f1Score}%`} color="var(--amber)" />
        <StatCard label="ROC-AUC" value={`${m.rocAuc}%`} color="#818cf8" />
      </div>

      <div className="split-2">
        <div className="card enter enter-2">
          <div className="card-title">Metric Bars</div>
          <div className="card-sub">Reported evaluation metrics (%) — offline test set</div>
          {[
            { label: 'Accuracy', v: m.accuracy, c: 'var(--accent)' },
            { label: 'Precision', v: m.precision, c: 'var(--accent-2)' },
            { label: 'Recall', v: m.recall, c: 'var(--genuine)' },
            { label: 'F1 Score', v: m.f1Score, c: 'var(--amber)' },
            { label: 'ROC-AUC', v: m.rocAuc, c: '#818cf8' }
          ].map(({ label, v, c }) => (
            <div className="prob-row" key={label}>
              <div className="prob-head"><span>{label}</span><span style={{ color: c }}>{v}%</span></div>
              <div className="prob-track"><div className="prob-fill" style={{ width: `${v}%`, background: c }} /></div>
            </div>
          ))}
        </div>

        <div className="card enter enter-2">
          <div className="card-title">Confusion Matrix</div>
          <div className="card-sub">Binary evaluation (Fake = positive class) reported by the original project</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 10, alignItems: 'stretch' }}>
            <div />
            <div className="faint small" style={{ textAlign: 'center', alignSelf: 'end' }}>Predicted Negative (Genuine)</div>
            <div className="faint small" style={{ textAlign: 'center', alignSelf: 'end' }}>Predicted Positive (Fake)</div>
            <div className="faint small" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center' }}>Actual Negative</div>
            <CellBox label="TN" value={cm.TN} tone="good" />
            <CellBox label="FP" value={cm.FP} tone="bad" />
            <div className="faint small" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center' }}>Actual Positive</div>
            <CellBox label="FN" value={cm.FN} tone="bad" />
            <CellBox label="TP" value={cm.TP} tone="good" />
          </div>
          <p className="faint small" style={{ marginTop: 14 }}>
            TN = true negatives · FP = false positives · FN = false negatives · TP = true positives.
          </p>
        </div>
      </div>

      <div className="card section-gap enter enter-3">
        <div className="card-title">Reporting Notes</div>
        <ul className="small muted" style={{ paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li><b>Offline metrics:</b> everything on this page originates from the author's ML project and is provided as-is; independent verification on a held-out dataset is pending.</li>
          <li><b>Binary evaluation:</b> the classifier has two classes (Fake / Genuine) — the confusion matrix and metrics reflect that binary decision, and no third class exists at inference time.</li>
          <li><b>Live statistics:</b> the Dashboard and Analytics pages show real usage counts from this deployment. Those are usage metrics, not accuracy measurements.</li>
          <li>{m.meta?.note}</li>
        </ul>
      </div>
    </div>
  );
}

function CellBox({ label, value, tone }) {
  const bg = tone === 'good' ? 'var(--genuine-soft)' : 'var(--fake-soft)';
  const color = tone === 'good' ? 'var(--genuine)' : 'var(--fake)';
  const edge = tone === 'good' ? 'rgba(52, 211, 153, 0.4)' : 'rgba(251, 113, 133, 0.4)';
  const glow = tone === 'good' ? 'rgba(52, 211, 153, 0.16)' : 'rgba(251, 113, 133, 0.16)';
  return (
    <div style={{
      background: `linear-gradient(165deg, ${bg}, rgba(3, 7, 18, 0.4))`,
      borderRadius: 12, padding: '18px 10px', textAlign: 'center',
      border: `1px solid ${edge}`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 22px ${glow}`
    }}>
      <div className="faint small" style={{ fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color, textShadow: `0 0 20px ${glow}` }}>{value}</div>
    </div>
  );
}
