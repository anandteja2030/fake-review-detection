import Banner from '../components/ui/Banner.jsx';
import PipelineDiagram from '../components/PipelineDiagram.jsx';
import { useModelStatus } from '../hooks/useModels.js';

const FEATURE_CARDS = [
  { t: 'Word-level TF-IDF', d: 'Unigram/bigram term weighting over cleaned review text — captures discriminative vocabulary such as promotional phrasing.' },
  { t: 'Character-level TF-IDF', d: 'Character n-grams add robustness to misspellings, punctuation bombs ("!!!") and obfuscated wording.' },
  { t: 'Sentence-BERT (all-MiniLM-L6-v2)', d: 'Normalized 384-dim semantic embeddings ground the model in meaning and feed the similarity signal.' },
  { t: 'Linguistic / Manual Features', d: 'Review length, character length, repetition ratio, VADER sentiment, promotional-keyword score, rating–sentiment gap, average word length, short-review flag and semantic similarity — in that saved column order.' }
];

const MODEL_CARDS = [
  { t: 'Logistic Regression', d: 'Linear model over the full sparse hybrid space (word + char TF-IDF, SBERT, manual features).' },
  { t: 'XGBoost', d: 'Gradient-boosted trees over the dense SBERT + manual feature block.' },
  { t: 'LightGBM', d: 'Fast leaf-wise boosting over the same dense block, complementary error profile to XGBoost.' },
  { t: 'Stacking Ensemble', d: 'The three base models’ class-1 probabilities form a 3-column matrix consumed by a Logistic Regression meta-model, thresholded at the saved 0.47375 cut-off.' }
];

export default function Research() {
  const { status } = useModelStatus();
  const connected = status?.connected === true;

  return (
    <div className="page">
      <div className="page-header enter">
        <h1>Research / About</h1>
        <p>Methodology, architecture and integration contract for the hybrid NLP + stacking-ensemble fake review detection system.</p>
      </div>

      <div className="card hud-corners enter enter-1" style={{ marginBottom: 22 }}>
        <div className="card-title">Project Overview</div>
        <p className="small muted" style={{ maxWidth: 840 }}>
          Fake reviews erode trust in e-commerce. This research application classifies a product review as
          <b style={{ color: 'var(--fake)' }}> Fake</b> or <b style={{ color: 'var(--genuine)' }}> Genuine</b> —
          a <b>binary</b> classifier (there is no trained Suspicious class) built on a hybrid feature
          representation (word TF-IDF, character TF-IDF, Sentence-BERT embeddings and handcrafted linguistic
          features) feeding a stacking ensemble of Logistic Regression, XGBoost and LightGBM with a Logistic
          Regression meta-model. Predictions are served through a FastAPI inference service and an Express
          adapter, with measured signals shown alongside every verdict for auditability.
        </p>
      </div>

      <div className="card enter enter-1" style={{ marginBottom: 22 }}>
        <div className="card-title">Methodology Pipeline</div>
        <div className="card-sub">End-to-end flow of the original ML system.</div>
        <PipelineDiagram />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 22 }}>
        <div className="card hoverable">
          <div className="card-title">Hybrid Feature Families</div>
          <div className="card-sub">Four parallel representations, concatenated in the saved training order.</div>
          <div className="grid" style={{ gap: 12 }}>
            {FEATURE_CARDS.map((f) => (
              <div key={f.t} className="metric-tile">
                <div className="k">{f.t}</div>
                <div className="small muted">{f.d}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card hoverable">
          <div className="card-title">Model Stack</div>
          <div className="card-sub">Three base learners + a Logistic Regression meta-model, evaluated offline with accuracy, precision, recall, F1 and ROC-AUC.</div>
          <div className="grid" style={{ gap: 12 }}>
            {MODEL_CARDS.map((f) => (
              <div key={f.t} className="metric-tile">
                <div className="k">{f.t}</div>
                <div className="small muted">{f.d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="spread">
          <div>
            <div className="card-title">Integration Status</div>
            <div className="card-sub" style={{ marginBottom: 0 }}>
              Connection between the Express API and the Python FastAPI inference service.
            </div>
          </div>
          <span className={`model-badge${connected ? ' connected' : ''}`}>
            <span className="dot" />{connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>
        <div className="section-gap">
          {connected ? (
            <p className="small muted" style={{ marginBottom: 14 }}>
              The Python inference service is <b>live</b>: <code className="mono">POST /api/analyze</code>{' '}
              forwards <code className="mono">{'{ text, rating }'}</code> to the FastAPI service, which loads the
              saved artifacts (TF-IDF vectorizers, SBERT encoder, base models, meta-model, threshold) and returns
              a binary verdict with complementary probabilities. History, dashboards and analytics are populated
              from these real predictions.
            </p>
          ) : (
            <p className="small muted" style={{ marginBottom: 14 }}>
              The adapter interface is ready but <b>no model is connected</b>.{' '}
              <code className="mono">POST /api/analyze</code> responds with{' '}
              <code className="mono">status: "model_not_connected"</code> and heuristic text measurements only —
              no prediction values are fabricated at any point. To connect the real system, run the Python
              inference service and set:
            </p>
          )}
          <div className="code-block" style={{ marginBottom: 14 }}>
            ML_ADAPTER_MODE=python-http<br />
            ML_SERVICE_URL=http://127.0.0.1:8501/predict
          </div>
          <p className="small muted" style={{ marginBottom: 10 }}>The Python service accepts:</p>
          <div className="code-block" style={{ marginBottom: 10 }}>{`POST /predict
{ "text": "review text", "rating": 5 }`}</div>
          <p className="small muted" style={{ marginBottom: 10 }}>and responds:</p>
          <div className="code-block">{`{
  "label": "fake | genuine",
  "probabilities": { "fake": 0.72, "genuine": 0.28 },
  "confidence": 0.72,
  "trustScore": 28,
  "riskLevel": "high | low",
  "modelId": "frd-stack-v1",
  "modelVersion": "1.0.0",
  "evidence": {
    "reviewText": "the exact submitted text",
    "threshold": 0.4738,
    "topEvidence": [ { "id": "decision", "category": "model",
                       "label": "Stacking ensemble verdict: FAKE", "detail": "P(fake) = 0.7200 vs ..." } ],
    "suspiciousWords": [ { "word": "amazing", "count": 2, "reason": "promotional keyword ..." } ],
    "measuredSignals": [ { "key": "promo_score", "label": "Promotional keyword score",
                           "value": 3, "unit": "keywords", "description": "...",
                           "available": true, "unavailableReason": null } ],
    "explanationSummary": "The model classified this 21-token review as FAKE ( ... )",
    "limitations": [ "Measured signals are inputs to the model ..." ],
    "attribution": { "method": "term-ablation-perturbation", "status": "available",
                     "description": "Term-ablation sensitivity: ...", "terms": [ ... ] }
  }
}`}</div>
          <p className="faint small" style={{ marginTop: 12 }}>
            The model is binary: probabilities carry exactly two keys —{' '}
            <code className="mono">fake</code> and <code className="mono">genuine</code> — and{' '}
            <code className="mono">trustScore</code> /{' '}
            <code className="mono">riskLevel</code> are derived presentation values, not trained outputs.
            Non-numeric probabilities, a non-binary label or a malformed evidence object are rejected with a
            502 so a broken integration can never silently degrade into placeholder output — and a missing
            evidence object is an error, never an empty success.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-title">Batch Processing &amp; Product Metadata</div>
        <div className="card-sub">How multiple reviews flow through the same trained pipeline.</div>
        <p className="small muted" style={{ maxWidth: 900, marginTop: 10 }}>
          <code className="mono">POST /api/analyze/batch</code> accepts up to{' '}
          <code className="mono">maxBatch</code> review entries (default 10, configurable via{' '}
          <code className="mono">BATCH_MAX_REVIEWS</code>) in one request. Every entry carries its own text,
          its own 1–5 star rating, an optional product name, and a required product category
          (preset list or custom string). Entries are validated independently — one invalid entry never
          blocks the valid ones — and each valid entry is sent to the <b>same</b> FastAPI predictor with
          bounded concurrency (3 at a time). Results are associated back to their entry by{' '}
          <code className="mono">ref</code>/<code className="mono">index</code>, and every completed
          prediction is written to history exactly once with its metadata and batch id. Failed entries
          write nothing — no prediction is ever fabricated for a failed request.
        </p>
        <div className="code-block" style={{ marginTop: 12 }}>{`POST /api/analyze/batch
{ "reviews": [
  { "ref": "r1", "text": "…", "rating": 5,
    "productName": "Wireless Headphones", "productCategory": "Electronics" },
  { "ref": "r2", "text": "…", "rating": 2,
    "productCategory": "Beauty and Skincare" } ] }

→ { "batchId": "b_…", "summary": { "submitted": 2, "completed": 2,
    "predicted": 2, "fake": 1, "genuine": 1, "failed": 0, "invalid": 0 },
  "results": [ { "ref": "r1", "status": "completed", "analysis": { … } }, … ] }`}</div>
        <p className="faint small" style={{ marginTop: 12 }}>
          <b>Product category and star rating are review metadata</b> for organization, filtering, and
          display. The trained model classifies from review text; star rating is used only for the
          rating–sentiment-gap signal. Category is never a model feature. Records stored before metadata
          existed are honestly shown as <b>Uncategorized</b>.
        </p>
      </div>

      <Banner kind="info">
        <b>Integrity statement:</b> labels, probabilities and confidence are produced exclusively by the trained
        ML pipeline; trust score and risk level are explicitly tagged as derived; measured signals are labeled as
        rule-based, never as proof or model attribution. Reported evaluation metrics on the Model Performance
        page are author-provided values shown verbatim.
      </Banner>
    </div>
  );
}
