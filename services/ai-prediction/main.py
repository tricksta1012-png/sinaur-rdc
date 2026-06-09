"""
SINAUR-RDC AI Prediction Service — top-level FastAPI application.

Starts 3 agents:
  1. VeilleAgent    — data ingestion from ReliefWeb, Open-Meteo, FEWS NET, OCHA HDX, Mettelsat
  2. PredictionAgent — risk scoring (26 provinces × 4 risk types, 6h cadence)
  3. AntiFraudAgent  — beneficiary dossier fraud/deduplication (on-demand via API)

All /internal/* routes require X-Internal-API-Key header.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from agents.antifraud.router import router as antifraud_router
from agents.prediction.router import router as prediction_router
from agents.veille.router import router as veille_router
from config import settings
from redis_client import close_redis, get_redis

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(message)s",
)

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start all agents on startup, stop on shutdown."""
    logger.info("sinaur_rdc.startup", service="ai-prediction", version="2.0.0")

    # Start Veille agent (data collection)
    try:
        from agents.veille.agent import veille_agent
        await veille_agent.start()
        logger.info("lifespan.veille_agent_started")
    except Exception as exc:
        logger.warning("lifespan.veille_agent_start_failed", error=str(exc))

    # Start Prediction agent (risk scoring)
    try:
        from agents.prediction.agent import prediction_agent
        await prediction_agent.start()
        logger.info("lifespan.prediction_agent_started")
    except Exception as exc:
        logger.warning("lifespan.prediction_agent_start_failed", error=str(exc))

    # Verify Redis connectivity
    try:
        redis = get_redis()
        await redis.ping()
        logger.info("lifespan.redis_connected")
    except Exception as exc:
        logger.warning("lifespan.redis_unavailable", error=str(exc))

    yield

    # Shutdown
    logger.info("sinaur_rdc.shutdown")

    try:
        from agents.veille.agent import veille_agent
        await veille_agent.stop()
    except Exception:
        pass

    try:
        from agents.prediction.agent import prediction_agent
        await prediction_agent.stop()
    except Exception:
        pass

    await close_redis()
    logger.info("sinaur_rdc.shutdown_complete")


app = FastAPI(
    title="SINAUR-RDC AI Prediction Service",
    description=(
        "Système National d'Alerte et d'Urgence — République Démocratique du Congo. "
        "Service IA: veille, prédiction des risques, anti-fraude."
    ),
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restricted to internal Docker network
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


# --- API Key middleware for /internal/* routes ---

@app.middleware("http")
async def internal_api_key_middleware(request: Request, call_next):
    """
    Require X-Internal-API-Key header for all /internal/* endpoints.
    """
    if request.url.path.startswith("/internal/"):
        provided_key = request.headers.get("X-Internal-API-Key", "")
        if provided_key != settings.internal_api_key:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "error": "unauthorized",
                    "detail": "Missing or invalid X-Internal-API-Key header",
                },
            )
    return await call_next(request)


# --- Exception handler ---

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        "unhandled_exception",
        url=str(request.url),
        method=request.method,
        error=str(exc),
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "detail": str(exc)},
    )


# --- Health endpoint ---

@app.get("/health", tags=["health"])
async def health():
    """
    Public health check — returns service status and agent health summaries.
    """
    db_status = "unknown"
    redis_status = "unknown"

    try:
        from db import engine
        async with engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        db_status = "ok"
    except Exception as exc:
        db_status = f"error: {exc}"

    try:
        redis = get_redis()
        await redis.ping()
        redis_status = "ok"
    except Exception as exc:
        redis_status = f"error: {exc}"

    try:
        from agents.veille.agent import veille_agent
        veille_health = veille_agent.get_health()
    except Exception:
        veille_health = {"error": "unavailable"}

    try:
        from agents.prediction.models.registry import registry
        models = registry.list_versions()
    except Exception:
        models = []

    return {
        "status": "ok",
        "service": "sinaur-rdc-ai-prediction",
        "version": "2.0.0",
        "database": db_status,
        "redis": redis_status,
        "veille": veille_health,
        "models_registered": len(models),
        "models": models,
    }


# --- Mount internal routers ---

app.include_router(veille_router)
app.include_router(prediction_router)
app.include_router(antifraud_router)
