# The product API. eval/Dockerfile is a separate image for the private grader;
# do not point a backend deploy at it.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq5 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
WORKDIR /app
# mirror-resolve is a path dependency of backend, so the build context is the repo root.
COPY resolve ./resolve
COPY backend ./backend
WORKDIR /app/backend
RUN uv sync --frozen --no-dev
# Workers are separate long-running processes (see tools/dev-up.sh). Run them as their
# own Railway services with START_MODULE set, so a crashed worker cannot take the API down.
ENV START_MODULE=""
EXPOSE 8000
CMD ["sh","-c","if [ -n \"$START_MODULE\" ]; then exec uv run python -m \"$START_MODULE\"; else exec uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}; fi"]
