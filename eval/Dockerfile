# Evaluation preparation API for Railway or any Docker host.
# Build context MUST be the repository root (mirror-resolve is a path dependency):
#   docker build -f eval/Dockerfile --build-arg RUN_ROOT=eval/runs/preparation-pilot-v2 -t eval-api .
# RUN_ROOT is the local initialized experiment root; it is baked in so job tokens
# and the journal match the operator-side launcher/collector.
FROM python:3.11-slim
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY resolve ./resolve
COPY backend ./backend
COPY eval ./eval
RUN cd backend && uv sync --frozen
ARG RUN_ROOT
RUN test -n "$RUN_ROOT" && test -f "$RUN_ROOT/manifest.json"
COPY ${RUN_ROOT} /run
EXPOSE 8088
CMD ["sh","-c","cd /app/backend && uv run python ../eval/scripts/preparation.py --root /run serve --host 0.0.0.0 --port ${PORT:-8088}"]
