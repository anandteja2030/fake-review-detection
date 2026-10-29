"""
FastAPI service exposing the EXISTING Fake Review Detection pipeline.

Endpoints:
    POST /predict     - full contract (label, probabilities, confidence, ...)
    GET  /health      - liveness probe
    GET  /model-info  - model identity + readiness

Startup behavior:
    - Loads ALL heavy components ONCE (models, vectorizers, scaler, thresholds,
      reference embeddings, Sentence-BERT encoder).
    - If any artifact is missing -> startup FAILS with ArtifactError (loudly).
    - If original-pipeline integration stubs are still unresolved, the service
      STARTS but /predict returns HTTP 503 with the exact stub list, so the
      Node adapter can never mistake it for a working model.
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import predictor
from predictor import (load_model_bundle, predict_review,
                       ArtifactError, unresolved_stubs)

load_dotenv()  # reads ml/.env if present

MODEL_ID = os.getenv("MODEL_ID", "frd-stack-v1")
MODEL_VERSION = os.getenv("MODEL_VERSION", "1.0.0")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
ML_SERVICE_HOST = os.getenv("ML_SERVICE_HOST", "127.0.0.1")
ML_SERVICE_PORT = int(os.getenv("ML_SERVICE_PORT", "8501"))


@asynccontextmanager
async def lifespan(_app):
    """Heavy loading happens exactly once, at process start."""
    try:
        predictor.bundle = load_model_bundle()
        print("[startup] all artifacts loaded:",
              ", ".join(predictor.ARTIFACT_FILES))
    except ArtifactError as exc:
        print(f"[startup] FATAL: {exc}")
        raise
    yield


app = FastAPI(title="Fake Review Detection - Inference Service",
              version=MODEL_VERSION, lifespan=lifespan)


class PredictRequest(BaseModel):
    text: str = Field(..., min_length=1)
    rating: int = Field(..., ge=1, le=5)


class TopEvidenceItem(BaseModel):
    id: str
    category: str  # "model" | "measured" | "attribution"
    label: str
    detail: str


class SuspiciousWordItem(BaseModel):
    word: str
    count: int = Field(..., ge=1)
    reason: str


class MeasuredSignal(BaseModel):
    key: str
    label: str
    value: float | str | None = None
    unit: str | None = None
    description: str
    available: bool
    unavailableReason: str | None = None


class AttributionTerm(BaseModel):
    term: str
    pFakeOriginal: float
    pFakeWithoutTerm: float
    deltaFakeProbability: float
    labelWithoutTerm: str
    wouldChangeLabel: bool


class Attribution(BaseModel):
    method: str | None
    status: str  # "available" | "unavailable"
    description: str
    unavailableReason: str | None = None
    terms: list[AttributionTerm] = []
    partialFailures: list[str] | None = None


class Evidence(BaseModel):
    """Per-review evidence - exact contract shared with Express and the UI."""
    version: int
    reviewText: str
    threshold: float
    topEvidence: list[TopEvidenceItem] = Field(..., min_length=1)
    suspiciousWords: list[SuspiciousWordItem]
    measuredSignals: list[MeasuredSignal] = Field(..., min_length=1)
    explanationSummary: str = Field(..., min_length=1)
    limitations: list[str] = Field(..., min_length=1)
    attribution: Attribution


class PredictResponse(BaseModel):
    label: str
    probabilities: dict
    confidence: float
    trustScore: int
    riskLevel: str
    modelId: str
    modelVersion: str
    evidence: Evidence


def _service_state() -> dict:
    stubs = unresolved_stubs()
    bundle = getattr(predictor, "bundle", None)
    return {
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "embeddingModel": EMBEDDING_MODEL,
        "status": "ready" if (bundle is not None and not stubs) else "not_ready",
        "artifactsLoaded": bundle is not None,
        "unresolvedStubs": stubs,
    }


@app.get("/health")
def health():
    bundle = getattr(predictor, "bundle", None)
    return {
        "status": "ok" if bundle is not None else "loading",
        "artifactsLoaded": bundle is not None,
        "unresolvedStubs": unresolved_stubs(),
    }


@app.get("/model-info")
def model_info():
    state = _service_state()
    # Contract per spec: modelId, modelVersion, embeddingModel, status.
    return {
        "modelId": state["modelId"],
        "modelVersion": state["modelVersion"],
        "embeddingModel": state["embeddingModel"],
        "status": state["status"],
        "artifactsLoaded": state["artifactsLoaded"],
        "unresolvedStubs": state["unresolvedStubs"],
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    state = _service_state()

    if state["status"] != "ready":
        # Honest failure: 503 with the exact reason. The Node adapter maps
        # non-2xx to ML_SERVICE_ERROR; nothing fabricated is ever returned.
        return JSONResponse(
            status_code=503,
            content={
                "error": "SERVICE_NOT_READY",
                "artifactsLoaded": state["artifactsLoaded"],
                "unresolvedStubs": state["unresolvedStubs"],
                "message": ("Integration stubs from the original ML project are "
                            "not yet replaced - no prediction is produced."),
            },
        )

    try:
        return predict_review(predictor.bundle, req.text, req.rating)
    except NotImplementedError as exc:
        return JSONResponse(status_code=503, content={
            "error": "STUB_UNRESOLVED",
            "message": str(exc),
        })
    except Exception as exc:  # pragma: no cover - surfaced honestly, never faked
        return JSONResponse(status_code=500, content={
            "error": "INFERENCE_ERROR",
            "message": f"{type(exc).__name__}: {exc}",
        })


# Local: python serve.py   (or: uvicorn serve:app --host 127.0.0.1 --port 8501)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=ML_SERVICE_HOST, port=ML_SERVICE_PORT)
