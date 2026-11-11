import Banner from '../components/ui/Banner.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import PipelineDiagram from '../components/PipelineDiagram.jsx';
import { useModelStatus } from '../hooks/useModels.js';

const FEATURE_CARDS = [
  { t: 'Word-level TF-IDF', d: 'Unigram/bigram term weighting over cleaned review text. It captures discriminative vocabulary, although the current artifacts give promotional phrasing almost no weight (see the audit below).' },
  { t: 'Character-level TF-IDF', d: 'Character n-grams add robustness to misspellings, punctuation bombs ("!!!") and obfuscated wording.' },
  { t: 'Sentence-BERT (all-MiniLM-L6-v2)', d: 'Normalized 384-dim semantic embeddings ground the model in meaning and feed the similarity signal.' },
  { t: 'Linguistic / manual features', d: 'Review length, character length, repetition ratio, VADER sentiment, promotional-keyword score, rating–sentiment gap, average word length, short-review flag and semantic similarity — in that saved column order.' }
];

const MODEL_CARDS = [
  { t: 'Logistic Regression', d: 'Linear model over the full sparse hybrid space (word + char TF-IDF, SBERT, manual features).' },
  { t: 'XGBoost', d: 'Gradient-boosted trees over the dense SBERT + manual feature block.' },
  { t: 'LightGBM', d: 'Fast leaf-wise boosting over the same dense block, complementary error profile to XGBoost.' },
  { t: 'Stacking ensemble', d: 'The three base models’ class-1 probabilities form a 3-column matrix consumed by a Logistic Regression meta-model, thresholded at the saved 0.47375 cut-off.' }
];

const REQUEST_PATH = [
  { label: 'React workspace', note: 'Dashboard · Analyzer · Evidence · History', accent: false },
  { label: 'Express API', note: 'Validation, history, statistics, serialization', accent: false },
  { label: 'FastAPI inference service', note: 'POST /predict — saved artifacts loaded once at startup', accent: false },
  { label: 'Stacking ensemble result', note: 'Verdict · probabilities · confidence · evidence', accent: true }
];

export default function Research() {
  const { status } = useModelStatus();
  const connected = status?.connected === true;

  return (
    <div className="page">
      <PageHeader
        index="07"
        eyebrow="Project dossier"
        title={<>Research / <span className="grad-text">About</span></>}
        description="Methodology, architecture and the integration contract for this hybrid NLP + stacking-ensemble fake review detection system."
        meta={[
          { k: 'Task', v: 'Binary' },
          { k: 'Base models', v: '3 + meta' },
          { k: 'Feature sets', v: '4' },
          { k: 'Inference', v: status ? (connected ? 'Online' : 'Offline') : '…', tone: status ? (connected ? 'genuine' : 'fake') : undefined }
        ]}
        actions={<span className={`provenance-chip${connected ? ' live' : ''}`}>{connected ? 'Inference connected' : 'Offline'}</span>}
      />

      <div className="card enter enter-1" style={{ marginBottom: 16 }}>
        <div className="split-2">
          <div>
            <div className="eyebrow">Overview</div>
            <div className="card-title" style={{ fontSize: 'var(--fs-xl)' }}>Detecting deceptive product reviews</div>
            <p className="small muted" style={{ marginTop: 8, lineHeight: 1.7 }}>
              Fake reviews erode trust in e-commerce. This research application classifies a product review as
              <b style={{ color: 'var(--fake)' }}> Fake</b> or <b style={{ color: 'var(--genuine)' }}> Genuine</b> —
              a <b>binary</b> classifier (there is no trained Suspicious class) built on a hybrid feature
              representation (word TF-IDF, character TF-IDF, Sentence-BERT embeddings and handcrafted linguistic
              features) feeding a stacking ensemble of Logistic Regression, XGBoost and LightGBM with a Logistic
              Regression meta-model.
            </p>
            <p className="small muted" style={{ marginTop: 10, lineHeight: 1.7 }}>
              Predictions are served through a FastAPI inference service and an Express adapter, with measured
              signals shown alongside every verdict for auditability.
            </p>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="ref-item">
              <div className="ref-k">CLASSIFICATION TASK</div>
              <div className="ref-d">Supervised binary classification of product review text. The verdict is a model output — not a verified truth label.</div>
            </div>
            <div className="ref-item">
              <div className="ref-k">EXPLAINABILITY</div>
              <div className="ref-d">Per-review evidence: model outputs, derived indicators, measured text signals and term-ablation attribution, each explicitly labelled by origin.</div>
            </div>
            <div className="ref-item">
              <div className="ref-k">SCOPE LIMITS</div>
              <div className="ref-d">No claim of real-world fraud detection. Attribution is perturbation-based, not SHAP/LIME, and evaluation metrics are author-reported.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="dash-split" style={{ marginBottom: 16 }}>
        <div className="card enter enter-1">
          <div className="card-title">Methodology pipeline</div>
          <div className="card-sub">End-to-end flow of the original ML system.</div>
          <PipelineDiagram />
        </div>

        <div className="card enter enter-2">
          <div className="card-title">System architecture</div>
          <div className="card-sub">How a review travels through this deployment.</div>
          <div className="pipeline">
            {REQUEST_PATH.map((step, i) => (
              <div key={step.label} style={{ width: '100%', display: 'grid', justifyItems: 'center' }}>
                <div className={`pipeline-node${step.accent ? ' accent' : ''}`}>
                  {step.label}
                  <small>{step.note}</small>
                </div>
                {i < REQUEST_PATH.length - 1 && <div className="pipeline-arrow">↓</div>}
              </div>
            ))}
          </div>
          <div className="code-block" style={{ marginTop: 14 }}>
            ML_ADAPTER_MODE=python-http<br />
            ML_SERVICE_URL=http://127.0.0.1:8501/predict
          </div>
        </div>
      </div>

      <div className="split-2" style={{ marginBottom: 16 }}>
        <div className="card enter enter-2">
          <div className="card-title">Hybrid feature families</div>
          <div className="card-sub">Four parallel representations, concatenated in the saved training order.</div>
          <div className="ref-list">
            {FEATURE_CARDS.map((f) => (
              <div key={f.t} className="ref-item">
                <div className="ref-k">{f.t.toUpperCase()}</div>
                <div className="ref-d">{f.d}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card enter enter-2">
          <div className="card-title">Model stack</div>
          <div className="card-sub">Three base learners plus a Logistic Regression meta-model, evaluated offline with accuracy, precision, recall, F1 and ROC-AUC.</div>
          <div className="ref-list">
            {MODEL_CARDS.map((f) => (
              <div key={f.t} className="ref-item">
                <div className="ref-k">{f.t.toUpperCase()}</div>
                <div className="ref-d">{f.d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card enter enter-3" style={{ marginBottom: 16 }}>
        <div className="spread">
          <div>
            <div className="card-title">Integration status</div>
            <div className="card-sub" style={{ marginBottom: 0 }}>
              Connection between the Express API and the Python FastAPI inference service.
            </div>
          </div>
          <span className={`model-badge${connected ? ' connected' : ''}`}>
            <span className="dot" />{connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div className="section-gap">
          {connected ? (
            <p className="small muted" style={{ marginBottom: 12 }}>
              The Python inference service is <b>live</b>: <code className="mono">POST /api/analyze</code>{' '}
              forwards <code className="mono">{'{ text, rating }'}</code> to the FastAPI service, which loads the
              saved artifacts (TF-IDF vectorizers, SBERT encoder, base models, meta-model, threshold) and returns
              a binary verdict with complementary probabilities. History, dashboards and analytics are populated
              from these real predictions.
            </p>
          ) : (
            <p className="small muted" style={{ marginBottom: 12 }}>
              The adapter interface is ready but <b>no model is connected</b>.{' '}
              <code className="mono">POST /api/analyze</code> responds with{' '}
              <code className="mono">status: "model_not_connected"</code> and heuristic text measurements only —
              no prediction values are fabricated at any point. To connect the real system, run the Python
              inference service and set the environment below.
            </p>
          )}
          <p className="small muted" style={{ marginBottom: 6 }}>The Python service accepts:</p>
          <div className="code-block" style={{ marginBottom: 10 }}>{`POST /predict
{ "text": "review text", "rating": 5 }`}</div>
          <p className="small muted" style={{ marginBottom: 6 }}>and responds:</p>
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
    "topEvidence": [ ... ],
    "measuredSignals": [ ... ],
    "explanationSummary": "...",
    "limitations": [ ... ],
    "attribution": { "method": "term-ablation-perturbation", ... }
  }
}`}</div>
          <p className="faint small" style={{ marginTop: 10 }}>
            The model is binary: probabilities carry exactly two keys — <code className="mono">fake</code> and{' '}
            <code className="mono">genuine</code> — and <code className="mono">trustScore</code> /{' '}
            <code className="mono">riskLevel</code> are derived presentation values, not trained outputs.
            Non-numeric probabilities, a non-binary label or a malformed evidence object are rejected with a 502
            so a broken integration can never silently degrade into placeholder output — and a missing evidence
            object is an error, never an empty success.
          </p>
        </div>
      </div>

      <div className="card enter enter-3" style={{ marginBottom: 16 }}>
        <div className="card-title">Batch processing &amp; product metadata</div>
        <div className="card-sub">How multiple reviews flow through the same trained pipeline.</div>
        <p className="small muted" style={{ maxWidth: 920, lineHeight: 1.7 }}>
          <code className="mono">POST /api/analyze/batch</code> accepts up to{' '}
          <code className="mono">maxBatch</code> review entries (default 10, configurable via{' '}
          <code className="mono">BATCH_MAX_REVIEWS</code>) in one request. Every entry carries its own text, its
          own 1–5 star rating, an optional product name, and a required product category (preset list or custom
          string). Entries are validated independently — one invalid entry never blocks the valid ones — and
          each valid entry is sent to the <b>same</b> FastAPI predictor with bounded concurrency. Results are
          associated back to their entry by <code className="mono">ref</code>/<code className="mono">index</code>,
          and every completed prediction is written to history exactly once with its metadata and batch id.
          Failed entries write nothing — no prediction is ever fabricated for a failed request.
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
        <p className="faint small" style={{ marginTop: 10 }}>
          <b>Product category and star rating are review metadata</b> for organisation, filtering and display.
          The trained model classifies from review text; star rating is used only for the rating–sentiment-gap
          signal. Category is never a model feature. Records stored before metadata existed are honestly shown
          as <b>Uncategorized</b>.
        </p>
      </div>

      <div className="glass-card verify-card enter enter-3" style={{ marginBottom: 16 }}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <div>
            <div className="deck-title">Independent audit <span className="flip-badge">measured</span></div>
            <div className="card-sub" style={{ marginBottom: 0 }}>
              1 November 2026 · saved artifacts evaluated on 1,600 externally labelled reviews.
            </div>
          </div>
          <span className="provenance-chip">Reported metrics not reproduced</span>
        </div>
        <div className="research-grid">
          <div>
            <div className="ev-k">Audit ROC-AUC</div>
            <div className="ev-v">0.549</div>
            <div className="ev-desc">Chance-level ranking on the external corpus. Reported: 98.81%.</div>
          </div>
          <div>
            <div className="ev-k">Audit accuracy</div>
            <div className="ev-v">0.500</div>
            <div className="ev-desc">1,598 of 1,600 reviews were classified Genuine. Reported: 94.5%.</div>
          </div>
          <div>
            <div className="ev-k">Promotional wording</div>
            <div className="ev-v">0.011</div>
            <div className="ev-desc">LR weight per SD for <code>promo_score</code> — promotional terms barely move the verdict.</div>
          </div>
          <div>
            <div className="ev-k">Short-review distortion</div>
            <div className="ev-v">+8.8</div>
            <div className="ev-desc">Logit contributed by <code>short_flag</code> for a sub-5-word review.</div>
          </div>
        </div>
        <p className="faint small" style={{ marginTop: 12 }}>
          The repository contains no training data or split indices, so the audit cannot prove whether this corpus is
          in- or out-of-distribution. It is reported as a generalisation stress test, not as a replacement for a
          documented held-out split. Method: <code>docs/audit-2026-11-01.md</code>.
        </p>
      </div>

      <Banner kind="info">
        <b>Integrity statement:</b> labels, probabilities and confidence are produced exclusively by the trained
        ML pipeline; trust score and risk level are explicitly tagged as derived; measured signals are labelled
        as rule-based, never as proof or model attribution. Reported evaluation metrics on the Model Performance
        page are author-provided values shown verbatim.
      </Banner>
    </div>
  );
}
