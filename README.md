# Explainable Fake Review Detection

Research application for classifying product reviews as **Fake / Suspicious / Genuine** with
explainable output. Built around a hybrid NLP + stacking-ensemble ML project
(word/char TF-IDF + Sentence-BERT + linguistic features → Logistic Regression, XGBoost,
LightGBM → Logistic Regression meta-model).

> **Integration status: the real trained model is connected.** The Express API calls the
> FastAPI inference service in `ml/` (hybrid TF-IDF + manual + SBERT features → stacking
> ensemble). Predictions are binary — **Fake / Genuine** — with calibrated probabilities,
> trust score, risk level and a per-review `evidence` object (top evidence, matched
> promotional/repeated terms, the model's measured input features, a summary, limitations
> and optional term-ablation attribution). Signals that cannot be computed are reported as
> unavailable with a reason — never fabricated.

## Stack
- **Frontend** — React 18 + Vite + React Router + Recharts, dark/light theme, responsive
- **Backend** — Node + Express, ML adapter layer, JSON file persistence (zero external services)
- **Tests** — `node:test` API suite (11 tests, all passing), including determinism and
  no-fabricated-prediction assertions

## Run

```bash
npm install                    # installs both workspaces
./scripts/start-all.sh         # recommended: starts ML service + API + UI with health gates
```

`scripts/start-all.sh` starts services in dependency order (FastAPI → Express → Vite),
waits for each `/health` (including `modelConnected: true`), is idempotent — already-healthy
services are left running — and is safe to re-run after an environment restore.

Manual equivalent:

```bash
# 1. ML inference service (port 8501)
(cd ml && ./venv/bin/python serve.py)      # or: python -m uvicorn serve:app --port 8501

# 2. Express API (port 4000)
ML_ADAPTER_MODE=python-http ML_SERVICE_URL=http://127.0.0.1:8501/predict PORT=4000 node server/src/server.js

# 3. UI (port 3000)
(cd frontend && npx vite --port 3000 --host 0.0.0.0)
```

Other commands: `npm test` (backend suite), `npm run build` (production frontend bundle in
`frontend/dist`), `npm run dev:server` (API with auto-reload), `./scripts/stop-all.sh`.

## Pages
| Route | Purpose |
|---|---|
| `/` | Dashboard — hero, stat cards (total / fake / suspicious / genuine / avg trust), distribution + trend charts |
| `/analyzer` | Review Analyzer — rating picker, review text, sample reviews, result panel with all result fields |
| `/analytics` | Aggregate charts from recorded analyses (empty by design until real predictions exist) |
| `/explainability` | Explainable-AI methodology and the explanation contract |
| `/model-performance` | Author-reported metrics shown verbatim (Accuracy 94.5%, Precision 92.38%, Recall 97.00%, F1 94.63%, ROC-AUC 98.81%; confusion matrix TN 552 / FP 48 / FN 18 / TP 582) |
| `/history` | Prediction history table (records only appear from real model predictions) |
| `/research` | Methodology, feature families, model stack, integration contract |

## API
Base path `/api`. Endpoints: `GET /health`, `GET /model/status`, `POST /analyze`,
`GET /history`, `DELETE /history`, `GET /stats`, `GET /metrics/latest`, `GET /metrics/model-report`,
`GET /samples`.

## The inference contract (Express ↔ FastAPI)

`POST ML_SERVICE_URL` (default `http://127.0.0.1:8501/predict`):

```json
{ "text": "review text", "rating": 5 }
```

responds:

```json
{
  "label": "fake | genuine",
  "probabilities": { "fake": 0.0, "genuine": 0.0 },
  "confidence": 0.0,
  "trustScore": 0,
  "riskLevel": "low | high",
  "modelVersion": "optional",
  "evidence": {
    "reviewText": "the exact submitted text",
    "threshold": 0.4738,
    "topEvidence": [{ "id": "decision", "category": "model", "label": "...", "detail": "..." }],
    "suspiciousWords": [{ "word": "amazing", "count": 2, "reason": "..." }],
    "measuredSignals": [{ "key": "promo_score", "label": "...", "value": 3.0,
                          "unit": "keywords", "description": "...",
                          "available": true, "unavailableReason": null }],
    "explanationSummary": "readable summary built from THIS review's values",
    "limitations": ["..."],
    "attribution": { "method": "term-ablation-perturbation", "status": "available | unavailable",
                     "description": "...", "unavailableReason": null, "terms": [] }
  }
}
```

There is **no `suspicious` class** in the model; the contract is strictly binary and the
API rejects non-binary labels, probabilities that do not sum to 1, missing keys or a
malformed `evidence` object with a 502 — a broken integration can never silently degrade
into placeholder output, and a missing explanation is an error rather than an empty
success. The `evidence` object is schema-validated in Express (including the guard that
`evidence.reviewText` equals the submitted review and every suspicious word actually
appears in it) and persisted with each history record, so the Explainable-AI page renders
the evidence of the exact review you select. Signals that cannot be computed for a given
text are returned as `available: false` with a reason — never a fabricated number.

## Production deployment

The Express API serves the built SPA itself — one origin, one port, no CORS in the
browser (set `ALLOWED_ORIGINS` only if you host the frontend elsewhere):

```bash
npm run build                # -> frontend/dist (859 modules, ~15s)
node server/src/server.js     # serves /assets/* from frontend/dist, SPA fallback for app routes
```

- **Routing** — anything under `/api` hits the API; `/assets/*` is served with a 1-hour
  cache header; all other paths get `index.html` (client-side router owns the URL).
  Unknown `/api/*` routes return JSON `{error: "Not found"}` (never HTML).
- **Startup order** — FastAPI (8501) → Express (4000) → health-gate both (`/health`
  includes `modelConnected`), then serve. `scripts/start-all.sh` automates this.
- **Environment** — all values in `.env.example`. `ML_SERVICE_URL` must be reachable from
  the API host; `VITE_API_BASE` defaults to same-origin `/api` (Vite dev proxy in dev,
  Express in production), so no localhost URLs are baked into the build.
- **Storage** — JSON files under `server/data/` (back them up; swap for a DB when needed).
- **No secrets** — the app reads no API keys; nothing to inject at deploy time.

## Data files
- `server/data/model_metrics.json` — your reported evaluation metrics, stored verbatim
- `server/data/prediction_history.json` — recorded predictions (empty until the model is connected)
- `server/data/review_samples.json` — sample reviews for the Analyzer

Edit `model_metrics.json` if you re-evaluate the model; values are always displayed exactly as stored.
