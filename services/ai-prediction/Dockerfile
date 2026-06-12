# Multi-stage slim Dockerfile for SINAUR-RDC AI Prediction Service
# Stage 1: Build dependencies
FROM python:3.11-slim AS builder

WORKDIR /build

# System deps for psycopg2, asyncpg, lxml
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc build-essential libxml2-dev libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime image
FROM python:3.11-slim AS runtime

WORKDIR /app

# Runtime system deps only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 libxml2 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy new top-level service files
COPY main.py ./main.py
COPY config.py ./config.py
COPY db.py ./db.py
COPY redis_client.py ./redis_client.py
COPY agents/ ./agents/
COPY schemas/ ./schemas/

# Model artifacts directory
RUN mkdir -p /app/model_artifacts /app/model_store

ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import httpx; r = httpx.get('http://localhost:8000/health', timeout=5); r.raise_for_status()" \
    || exit 1

# Use the new top-level main.py
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
