# syntax=docker/dockerfile:1
#
# Single-container backend for free hosting (Hugging Face Spaces free CPU, or any
# Docker host). It runs BOTH services of this repository:
#
#   * FastAPI inference   ml/serve.py      -> 127.0.0.1:8501   (private)
#   * Express API         server/src/...   -> 0.0.0.0:$PORT    (public, 7860 on Spaces)
#
# The browser only ever talks to the Express API, so no cross-service URL has to
# be entered anywhere: ML_SERVICE_URL points at loopback *inside* the image.
# The GitHub Pages frontend is allowed through ALLOWED_ORIGINS.
#
# Build/test locally:
#   docker build -t frd-backend .
#   docker run --rm -p 7860:7860 frd-backend
#   curl http://127.0.0.1:7860/api/health
#
# Memory: the Python process peaks around 0.8-1.2 GB with the models loaded, so
# this image does NOT fit a 512 MB instance. Hugging Face Spaces free CPU gives
# 16 GB, which is why it is the default free target.

# Node 20 comes from the official image (no apt repository needed).
FROM node:20-bookworm-slim AS nodebin

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/cache/huggingface \
    NLTK_DATA=/opt/cache/nltk \
    EMBEDDING_MODEL=all-MiniLM-L6-v2 \
    MODEL_ID=frd-stack-v1 \
    MODEL_VERSION=1.0.0 \
    ML_ADAPTER_MODE=python-http \
    ML_SERVICE_URL=http://127.0.0.1:8501/predict \
    ML_SERVICE_PORT=8501 \
    ALLOWED_ORIGINS=https://anandteja2030.github.io \
    PORT=7860

# LightGBM and XGBoost load libgomp.so.1 at import time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=nodebin /usr/local/bin/node /usr/local/bin/node
COPY --from=nodebin /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

WORKDIR /app

# Python dependencies first so code edits do not re-download torch.
COPY ml/requirements.txt ml/requirements.txt
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0 \
 && pip install -r ml/requirements.txt

# Cache the Sentence-BERT encoder and the VADER lexicon in the image, so a cold
# start never depends on the network (same approach as render.yaml).
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" \
 && python -c "import nltk; nltk.download('vader_lexicon', quiet=True)"

# Application code. The model artifacts in ml/models/ are tracked in git.
COPY ml/ ml/
COPY server/ server/

# Only the Express workspace is needed at runtime.
RUN cd /app/server && npm install --omit=dev --no-audit --no-fund

COPY deploy/hf-space/entrypoint.sh /app/entrypoint.sh
# Normalize line endings before making it executable: a Windows checkout (or
# git archive with core.autocrlf=true) stores CRLF, and the kernel then fails
# with `env: 'bash\r': No such file or directory` (exit 127).
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 7860

# The entrypoint starts FastAPI in the background, then Express in the
# foreground, and exits (=> platform restart) if either process dies.
CMD ["/app/entrypoint.sh"]
