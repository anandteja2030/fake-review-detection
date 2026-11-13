# Connecting the Python ML inference pipeline

The adapter layer lives in `server/src/mlAdapter.js` and is the **only** file that needs to
succeed for predictions to flow. This repository ships `ml/serve.py` and the configuration
below, so the integrated setup is `ML_ADAPTER_MODE=python-http` pointed at it; when the
adapter mode is unset the API stays in `none` and returns honest not-connected responses.

## Option A — HTTP service (what this repository ships)

`ml/serve.py` is the FastAPI implementation: it loads the saved artifacts (TF-IDF
vectorizers, MiniLM encoder, base models, stacker) and serves `POST /predict`, plus
`GET /health` (readiness via `artifactsLoaded`) and `GET /model-info`.

Request:

```json
{ "text": "review text", "rating": 5 }
```

Response (abridged; `evidence` carries the full explanation object):

```json
{
  "label": "fake",
  "probabilities": { "fake": 0.81, "genuine": 0.19 },
  "confidence": 0.81,
  "trustScore": 19,
  "riskLevel": "high",
  "modelId": "frd-stack-v1",
  "modelVersion": "1.0.0",
  "evidence": { "version": 1, "reviewText": "review text", "threshold": 0.47375 }
}
```

`label` is binary (`fake` | `genuine`) — there is no Suspicious class — and both
probabilities are always present and sum to 1. The `evidence` object is **required**: a
missing or malformed one is a 502, never an empty success. Its full shape is documented in
the README section *The inference contract*.

Then set `ML_ADAPTER_MODE=python-http` and `ML_SERVICE_URL=http://127.0.0.1:8501/predict`
(the URL must end in `/predict`; with a loopback URL the API starts, health-gates and
restarts `ml/serve.py` itself).

## Option B — direct in-process integration (not implemented)

Not needed for correctness: for a loopback `ML_SERVICE_URL`, `mlSupervisor.js` already owns
the engine lifecycle, so a child-process/IPC call would only remove the HTTP hop. If it is
ever built, the response contract must stay identical so the frontend needs no changes.

## Contract guarantees enforced by the adapter
- Binary `probabilities.fake` / `probabilities.genuine` (complementary, summing to 1), a
  binary `label`, and a valid `evidence` object required, else 502 `ML_BAD_RESPONSE`.
- Service unreachable → 502 `ML_SERVICE_UNREACHABLE` (frontend shows a proper error state).
- Inference exceeded `ML_REQUEST_TIMEOUT_MS` → 503 `ML_SERVICE_TIMEOUT`.
- Non-2xx reply → 502 `ML_SERVICE_ERROR`; the upstream status is kept on the error object
  (`httpStatus`) and is not echoed in the response body.
- Transient failures (connection errors, 429/502/503/504) are retried up to
  `ML_MAX_RETRIES` times with exponential backoff before the error above is
  raised; a 4xx reply and a 500 are never retried. See `.env.example`.
- While `ML_ADAPTER_MODE=none`, `/api/analyze` returns 200 with
  `status: "model_not_connected"` and **null** prediction fields plus real heuristic features.
- Nothing in the UI presents heuristic measurements as model output.
