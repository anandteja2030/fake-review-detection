---
title: Explainable Fake Review Detection API
emoji: 🔎
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Explainable Fake Review Detection — backend

One container, both backend services of
[anandteja2030/fake-review-detection](https://github.com/anandteja2030/fake-review-detection):

| Process | Address | Role |
|---|---|---|
| FastAPI (`ml/serve.py`) | `127.0.0.1:8501` (private) | real model inference: word/char TF-IDF + Sentence-BERT + LR/XGBoost/LightGBM stacking ensemble + evidence |
| Express (`server/src/server.js`) | `0.0.0.0:7860` (public) | the `/api/*` contract the React app already uses |

The browser never talks to FastAPI directly — Express proxies predictions over
loopback, so there is no cross-service URL to configure.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness + history backend |
| GET | `/api/model/status` | adapter mode, ML URL, connection state |
| GET | `/api/categories` | product categories + batch limit |
| GET | `/api/samples` | sample reviews for the analyzer |
| POST | `/api/analyze` | single review → verdict, probabilities, trust, evidence |
| POST | `/api/analyze/batch` | up to 10 reviews, per-entry validation |
| GET | `/api/history` | prediction history (`?category=`, `?verdict=`) |
| DELETE | `/api/history` | clear history |
| GET | `/api/stats` | aggregates for the dashboard |
| GET | `/api/metrics/latest` | analytics window + distributions |
| GET | `/api/metrics/model-report` | stored model performance report |
| GET | `/health` (FastAPI) | model readiness — `artifactsLoaded: true` |

## Configuration

Everything needed is baked into the image. Optional Space variables/secrets:

| Name | Default | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | `https://anandteja2030.github.io` | CORS allowlist; add more origins comma-separated |
| `MONGODB_URI` | *(unset)* | set to a MongoDB Atlas M0 string so prediction history survives restarts (this filesystem is ephemeral) |
| `MONGODB_DB` | `frd` | database name |
| `ML_REQUEST_TIMEOUT_MS` | `60000` | per-attempt inference timeout |
| `ML_MAX_RETRIES` | `2` | bounded retries on 429/502/503/504 |

## Cold starts

Free CPU Spaces sleep after 48 hours without traffic. The first request then
waits for the container plus the model load (about 1–3 minutes); `/api/health`
answers as soon as Express is up, and predictions retry until FastAPI is ready.
Nothing is ever faked while the model is loading — the API returns
`ML_SERVICE_UNREACHABLE` instead.

## Verify

```bash
curl https://<space-host>/api/health
curl https://<space-host>/api/model/status
curl -X POST https://<space-host>/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"text":"The kettle boils quickly and the lid fits tightly after two weeks.","rating":4,"productCategory":"Home"}'
```

## Deploying / updating

The Space mirrors this repository. From GitHub Actions, run
**Deploy backend to Hugging Face Space** (needs the `HF_TOKEN` secret and the
`HF_SPACE` repository variable, e.g. `anandteja2030/fake-review-detection-api`).
Routes touched: `ml/**`, `server/**`, `Dockerfile`, `deploy/hf-space/**`.

Manual equivalent:

```bash
pip install -U huggingface_hub
hf auth login                                  # paste a write token
hf upload <user>/<space> Dockerfile Dockerfile --repo-type space
hf upload <user>/<space> deploy/hf-space/README.md README.md --repo-type space
hf upload <user>/<space> deploy/hf-space deploy/hf-space --repo-type space
hf upload <user>/<space> ml ml --repo-type space
hf upload <user>/<space> server server --repo-type space
```
