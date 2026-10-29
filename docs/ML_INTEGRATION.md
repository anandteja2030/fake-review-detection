# Connecting the Python ML inference pipeline

The adapter layer lives in `server/src/mlAdapter.js` and is the **only** file that needs to
succeed for predictions to flow. Current mode: `none` (honest not-connected responses).

## Option A — HTTP service (recommended, zero code changes here)
Wrap the saved artifacts (TF-IDF vectorizers, MiniLM encoder, base models, stacker) in FastAPI/Flask:

```python
# serve.py (sketch)
from fastapi import FastAPI
from pydantic import BaseModel
app = FastAPI()

class In(BaseModel):
    text: str
    rating: int

@app.post("/predict")
def predict(inp: In):
    # call your existing pipeline here; return the contract below
    return {
        "label": ...,            # "fake" | "suspicious" | "genuine"
        "probabilities": {"fake": ..., "suspicious": ..., "genuine": ...},
        "confidence": ...,       # max probability
        "trustScore": ...,       # 0-100, your definition
        "riskLevel": ...,        # "low" | "medium" | "high"
        "modelVersion": "1.0.0",
        "topEvidence": ["..."],  # optional explanation strings
        "suspiciousWords": ["..."]  # optional
    }
```

Then set `ML_ADAPTER_MODE=python-http` and `ML_SERVICE_URL=http://127.0.0.1:8501/predict`.

## Option B — direct in-process integration (later)
Swap the `python-http` branch in `mlAdapter.js` for a child-process/IPC call. Keep the response
contract identical so the frontend needs no changes.

## Contract guarantees enforced by the adapter
- Numeric `probabilities.fake/suspicious/genuine` required, else 502 `ML_BAD_RESPONSE`.
- Service unreachable → 502 `ML_SERVICE_UNREACHABLE` (frontend shows a proper error state).
- While `ML_ADAPTER_MODE=none`, `/api/analyze` returns 200 with
  `status: "model_not_connected"` and **null** prediction fields plus real heuristic features.
- Nothing in the UI presents heuristic measurements as model output.
