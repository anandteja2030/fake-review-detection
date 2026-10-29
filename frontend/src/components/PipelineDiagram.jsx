const STEPS = [
  { label: 'Review', note: 'Product review text + star rating' },
  { label: 'Text Cleaning', note: 'Normalization and preprocessing' },
  { label: 'Hybrid Feature Extraction', note: 'Parallel feature families' }
];

const FEATURES = ['Word TF-IDF', 'Character TF-IDF', 'Sentence-BERT', 'Manual Features'];
const MODELS = ['Logistic Regression', 'XGBoost', 'LightGBM'];

export default function PipelineDiagram() {
  return (
    <div className="pipeline">
      {STEPS.map((s) => (
        <div key={s.label}>
          <div className="pipeline-node">{s.label}<small>{s.note}</small></div>
          <div className="pipeline-arrow">↓</div>
        </div>
      ))}
      <div className="feature-split">
        {FEATURES.map((f) => <span key={f} className="chip">{f}</span>)}
      </div>
      <div className="pipeline-arrow">↓</div>
      <div className="feature-split">
        {MODELS.map((m) => <span key={m} className="chip">{m}</span>)}
      </div>
      <div className="pipeline-arrow">↓</div>
      <div className="pipeline-node accent">Stacking Ensemble<small>Logistic Regression meta-model</small></div>
      <div className="pipeline-arrow">↓</div>
      <div className="pipeline-node accent">Final Prediction</div>
      <div className="pipeline-arrow">↓</div>
      <div className="pipeline-node accent">Explainable Result</div>
    </div>
  );
}
