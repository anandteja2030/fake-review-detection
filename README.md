# Explainable Fake Review Detection

Research application for classifying product reviews as **Fake / Genuine** with
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
- **Backend** — Node + Express, ML adapter layer, JSON file persistence (optional MongoDB mirror on hosted deploys — see *Deploy verification*)
- **Tests** — `node:test` suite (75 tests, all passing): API contract, batch/evidence
  validation, ML transport (timeouts, bounded retries, no local spawn for a remote
  service), history persistence and Render blueprint rules — including determinism and
  no-fabricated-prediction assertions

## Run

```bash
npm install                    # installs both workspaces
./scripts/start-all.sh         # recommended: starts ML service + API + UI with health gates
```

`scripts/start-all.sh` starts services in dependency order (FastAPI → Express → Vite),
waits for the ML `/health` and the API `/api/health` (`/api/model/status` reports whether
the model is connected), is idempotent — already-healthy services are left running — and is
safe to re-run after an environment restore.

Manual equivalent:

```bash
# 1. ML inference service (port 8501)
(cd ml && ./.venv/bin/python serve.py)     # Windows: .venv/Scripts/python.exe

# 2. Express API (port 4000)
ML_ADAPTER_MODE=python-http ML_SERVICE_URL=http://127.0.0.1:8501/predict PORT=4000 node server/src/server.js

# 3. UI (port 3000)
(cd frontend && npx vite --port 3000 --host 0.0.0.0)
```

Other commands: `npm test` (backend suite), `npm run build` (production frontend bundle in
`frontend/dist`), `npm run dev:server` (API with auto-reload), `npm run validate:render`
(Render blueprint check). Stop the stack by ending the processes `start-all.sh` started.

## Pages
| Route | Purpose |
|---|---|
| `/` | Dashboard — hero, live metric tiles (reviews analyzed / predicted fake / predicted genuine / average trust), distribution + trend charts |
| `/analyzer` | Review Analyzer — rating picker, review text, sample reviews, result panel with all result fields |
| `/analytics` | Aggregate charts from recorded analyses (empty by design until real predictions exist) |
| `/explainability` | Explainable-AI methodology and the explanation contract |
| `/model-performance` | Author-reported metrics shown verbatim (Accuracy 94.5%, Precision 92.38%, Recall 97.00%, F1 94.63%, ROC-AUC 98.81%; confusion matrix TN 552 / FP 48 / FN 18 / TP 582) |
| `/history` | Prediction history table (records only appear from real model predictions) |
| `/research` | Methodology, feature families, model stack, integration contract |

## API
Base path `/api`. Endpoints: `GET /health`, `GET /model/status`, `GET /samples`,
`GET /categories`, `GET /metrics/model-report`, `GET /metrics/latest`, `GET /stats`,
`GET /history` (filters: `?category=`, `?verdict=`), `DELETE /history`, `POST /analyze`,
`POST /analyze/batch`.

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
npm run build                # -> frontend/dist (898 modules, ~16s)
node server/src/server.js     # serves /assets/* from frontend/dist, SPA fallback for app routes
```

- **Routing** — anything under `/api` hits the API; `/assets/*` is served with a 1-hour
  cache header; all other paths get `index.html` (client-side router owns the URL).
  Unknown `/api/*` routes return JSON `{error: "NOT_FOUND", message: …}` (never HTML).
- **Startup order** — FastAPI (8501) → Express (4000) → health-gate both (the ML
  `/health` and the API `/api/health`; `/api/model/status` reports the model connection),
  then serve. `scripts/start-all.sh` automates this.
- **Environment** — all values in `.env.example`. `ML_SERVICE_URL` must be reachable from
  the API host; `VITE_API_BASE` defaults to same-origin `/api` (Vite dev proxy in dev,
  Express in production) and **must** be set to the deployed API for the GitHub Pages build,
  which has no backend of its own.
- **Storage** — JSON files under `server/src/data/`. On a hosted deploy set `MONGODB_URI`
  so history survives restarts (see below); without it the file is the whole store.
- **Secrets** — only the optional `MONGODB_URI` connection string, entered in the
  Render dashboard. Nothing else needs to be injected.

## Free deployment (Hugging Face Space + GitHub Pages)

This is the zero-cost path and the recommended one.

**Why not everything on Render:** the ML service needs 2 GB (the model stack peaks near
1.2 GB while the 10 artifacts load) and Render's free instance is 512 MB, so it would be
OOM-killed. Hugging Face Spaces' free CPU tier gives 16 GB, so it hosts the model for free.

| Piece | Host | Free tier |
|---|---|---|
| Frontend | GitHub Pages | unlimited for public repos |
| FastAPI **and** Express (one container) | Hugging Face Space (Docker) | 2 vCPU / 16 GB, sleeps after 48 h idle |

`Dockerfile` runs both processes in one image: FastAPI on `127.0.0.1:8501` (private) and
Express on `0.0.0.0:7860` (public). The browser only talks to Express, so `ML_SERVICE_URL`
is loopback *inside* the container and there is no service-to-service URL to configure.

### Steps

1. **Create the Space** — huggingface.co → *New → Space* → SDK **Docker** → *Blank* →
   owner `anandteja2030`, name e.g. `fake-review-detection-api`, hardware *CPU basic (free)*.
2. **Authorise the deploy** — GitHub repo → *Settings → Secrets and variables → Actions*:
   - secret `HF_TOKEN` = a **write** token from https://huggingface.co/settings/tokens
   - variable `HF_SPACE` = `anandteja2030/fake-review-detection-api` (owner/name)
3. **Publish** — *Actions* → **Deploy backend to Hugging Face Space** → *Run workflow*.
   The Space rebuilds (the image installs CPU torch and pre-caches the encoder + VADER, so
   the first build takes a while).
4. **Copy the backend URL** from the Space page (form `https://<owner>-<space>.hf.space`)
   and check it: `curl https://<space-host>/api/health` → `status: "ok"`, then
   `curl https://<space-host>/api/model/status` → `connected: true` once `/health` on
   FastAPI reports `artifactsLoaded: true`.
5. **Point the frontend at it** — repository variable `VITE_API_BASE` =
   `https://<space-host>/api`, then re-run **Deploy frontend to GitHub Pages**.
6. **Optional durability** — add Space variable `MONGODB_URI` (Atlas M0) so prediction
   history survives restarts; otherwise history lives for the container's lifetime.

Free Spaces sleep after 48 idle hours. The first request then waits for the container and
model load (1–3 minutes); `/api/health` answers as soon as Express is up and predictions
retry until FastAPI is ready.

### Docker commands (local check)

```bash
docker build -t frd-backend .
docker run --rm -p 7860:7860 frd-backend
curl http://127.0.0.1:7860/api/health
```

## Deploy verification (Render)

`render.yaml` declares two services, each health-checked by the platform:

| Service | Runtime | Plan | Health check | Root | Start command |
|---|---|---|---|---|---|
| `frd-ml` | Python 3.12 (Uvicorn) | `standard` — 2 GB | `/health` | `ml/` | `uvicorn serve:app --host 0.0.0.0 --port $PORT` |
| `frd-api` | Node 20 (Express) | `free`, 1 instance (512 MB) | `/api/health` | `/` | `node server/src/server.js` |

The API runs on Render's **free** instance, so nothing in this deployment costs money. Free
instances are 0.1 CPU / 512 MB, single instance, and spin down after 15 idle minutes — the
next request waits about a minute for the boot (upgrade to `0.5c-512mb`, $7/mo, to keep it
warm). The API is a single instance because the history store rewrites one JSON document per
append.

The ML service cannot run free: the free instance is 512 MB and the model stack (torch +
transformers + sentence-transformers + sklearn/xgboost/lightgbm) peaks near 1.2 GB while the
10 saved artifacts load. It needs `standard` (`1c-2g`, 2 GB, $25/mo) — or another host that
offers at least 2 GB of RAM.

### Exact values to enter in the Render dashboard

Everything else comes from `render.yaml`. The values below are marked `sync: false` in the
blueprint, so Render prompts for them and they are never committed.

On **`frd-api` → Environment** (add each as an environment variable):

| Variable | Exact value | Notes |
|---|---|---|
| `ML_SERVICE_URL` | `https://<frd-ml host>/predict` | Copy the public URL from the `frd-ml` service page, e.g. `https://frd-ml.onrender.com/predict`. It **must** end in `/predict`; a bare host fails the wiring check. |
| `ALLOWED_ORIGINS` | *already set in `render.yaml`* | `https://anandteja2030.github.io` — exact origin, no trailing slash, no path. Override only to add more origins (comma-separated). |
| `MONGODB_URI` | Atlas connection string | Optional. Without it history is lost on every deploy. Secret — keep it out of the repo. |
| `MONGODB_DB` | `frd` | Already set in `render.yaml`; override only if you want another database. |
| `AFRD_HISTORY_FILE` | `/var/data/prediction_history.json` | Only when attaching a paid Render disk at `/var/data` instead of using `MONGODB_URI`. |

`frd-ml` needs no manual values: its Python version, model directory, model id/version,
embedding model and cache directories are all pinned in `render.yaml`.

Repository variables for GitHub Actions (**Settings → Secrets and variables → Actions →
Variables**):

| Variable | Exact value | Used by |
|---|---|---|
| `VITE_API_BASE` | `https://<frd-api host>/api` | Pages build. Baked in at build time, so re-run the Pages workflow after changing it. The workflow **fails** while this is empty, because a static host cannot answer `/api` (404 on GET, 405 on POST). |
| `SMOKE_API_BASE` | `https://<frd-api host>` | Scheduled deploy smoke check. While unset, that workflow skips instead of failing. |
| `SMOKE_ML_BASE` | `https://<frd-ml host>` | Scheduled deploy smoke check (optional; without it the ML health check is skipped). |

### Deployment order (first time)

1. **Create both services from the blueprint** — Render Dashboard → *New* → *Blueprint* →
   select this repository. Render reads `render.yaml` and creates `frd-ml` and `frd-api`.
   `frd-ml` takes several minutes: it installs CPU torch and the pinned requirements, then
   downloads the Sentence-BERT encoder and the VADER lexicon.
2. **Copy the ML URL.** Open `frd-ml`, copy its URL (e.g. `https://frd-ml-xxxx.onrender.com`)
   and confirm `https://frd-ml-xxxx.onrender.com/health` returns `"artifactsLoaded": true`.
3. **Wire the API to it.** `frd-api` → *Environment* → `ML_SERVICE_URL` =
   `https://frd-ml-xxxx.onrender.com/predict` (a bare host is completed automatically, but set
   the full path). `ALLOWED_ORIGINS` already allows the Pages origin. Add `MONGODB_URI` if you
   want history to survive restarts; saving an env var triggers a redeploy.
4. **Verify the pair** before touching the frontend:
   `npm run smoke:deploy -- --api https://frd-api-xxxx.onrender.com --ml https://frd-ml-xxxx.onrender.com`
5. **Point the frontend at the API** — GitHub repo → *Settings* → *Secrets and variables* →
   *Actions* → *Variables* → *New repository variable*: `VITE_API_BASE` =
   `https://frd-api-xxxx.onrender.com/api` (`/api` included).
6. **Rebuild Pages** — *Actions* → *Deploy frontend to GitHub Pages* → *Run workflow* →
   `main`. Hard-refresh the site once it is green.

### If it still does not work

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard: *Could not reach the API — Request failed (404)* | the published bundle was built without `VITE_API_BASE`, so it called `https://anandteja2030.github.io/api/...` | set the variable and re-run the Pages workflow; a bundle without it now reports `API_BASE_NOT_CONFIGURED` instead of a 404 |
| Analyzer: `NETWORK_ERROR — Request failed (405)` | same cause — GitHub Pages answers `POST` with 405 because it only serves files | as above |
| Model status *Offline* / `ML_SERVICE_UNREACHABLE` | `ML_SERVICE_URL` unset or loopback, or the ML service is asleep or failed to boot | set the real `/predict` URL; `GET https://<frd-ml>/health` must show `artifactsLoaded: true` |
| `502 ML_SERVICE_ERROR` and a 404 in the ML log | `ML_SERVICE_URL` points at the wrong path | it must be `https://<frd-ml>/predict` |
| Browser console: no `Access-Control-Allow-Origin` | the page origin is not in `ALLOWED_ORIGINS` | add the exact origin (`https://anandteja2030.github.io`), no trailing slash |
| First request after 15 idle minutes takes ~1 minute | the free API instance spun down | expected on `free`; upgrade to `0.5c-512mb` to remove it |

### Running the checks

```bash
npm run validate:render        # render.yaml vs Render's published Blueprint JSON schema
npm run smoke:deploy -- --api https://frd-api.onrender.com --ml https://frd-ml.onrender.com
```

`npm run smoke:deploy` accepts `--api` (a trailing `/api` is fine), `--ml`, `--timeout
<seconds>` for cold starts (default 120) and `--skip-failure-check`. It exits non-zero and
names the failing check:

| Check | Passes when | A failure means |
|---|---|---|
| API health | `GET /api/health` → 200 with `status: "ok"` | the API is down or still booting |
| ML service health | `GET /health` → 200 with `artifactsLoaded: true` | the ML service is up but models did not load |
| API wired to ML | `/api/model/status` → `adapterMode: python-http`, `connected: true`, non-empty `serviceUrl` | `ML_SERVICE_URL` is missing or still loopback |
| Real prediction | `POST /api/analyze` → 200, `status: model_connected`, verdict `fake`/`genuine`, probabilities summing to 1, evidence belonging to that review | the deploy returns no prediction or fabricates one |
| Input rejection | `POST /api/analyze` with empty text and rating 9 → 400 `INVALID_INPUT` | validation is bypassed |
| Unreachable ML | a local server pointed at a non-resolving ML host → 5xx, no prediction, no evidence, no history record | the failure path invents output |

The last check boots `server/src/server.js` locally against `http://unreachable.invalid:9/predict`,
because a deployed API's `ML_SERVICE_URL` cannot be changed from outside. Each run also
records one real analysis on the deployed API, so history grows by one record per run.

### CI

| Workflow | Trigger | What it runs |
|---|---|---|
| `render-config.yml` | push/PR touching `render.yaml`, the validator, the schema or the rules test | `npm run validate:render` + `server/tests/renderConfig.test.js` |
| `render-smoke.yml` | daily 06:00 UTC and manual dispatch | `npm run smoke:deploy` once `SMOKE_API_BASE` is set |
| `deploy-pages.yml` | push to `frontend/**` | builds and publishes the SPA to GitHub Pages (fails while `VITE_API_BASE` is empty) |
| `deploy-space.yml` | push to `ml/**`, `server/**`, `Dockerfile`, `deploy/hf-space/**` | publishes the backend container to the Hugging Face Space once `HF_TOKEN` + `HF_SPACE` exist |

Scheduled workflows only run from the default branch; the smoke check stays green (with a
notice) until the two `SMOKE_*` variables exist.

### History persistence

Render's filesystem is ephemeral. With `MONGODB_URI` set, history is mirrored to a free
MongoDB Atlas M0 cluster as one document holding the same JSON array, written before the
API answers, so a 200 means the record is durable. Without it, history lives only for the
life of the instance. `GET /api/health` reports which one is active:
`"history": {"backend": "mongodb" | "file", "durable": true | false, "lastError": null}`.
If the store is unreachable the API keeps serving from the file and reports the error in
`lastError` rather than failing requests.

## Data files
- `server/src/data/model_metrics.json` — your reported evaluation metrics, stored verbatim
- `server/src/data/prediction_history.json` — recorded predictions (empty until a real analysis is recorded)
- `server/src/data/review_samples.json` — sample reviews for the Analyzer

Edit `model_metrics.json` if you re-evaluate the model; values are always displayed exactly as stored.
