"""
Service de prédiction IA SINAUR-RDC — FastAPI application.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .api.predictions import router as predictions_router
from .api.internal import router as internal_router
from .api.veille import router as veille_router
from .api.antifraud import router as antifraud_router
from .api.connaissance import router as connaissance_router

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pré-charger les modèles au démarrage pour éviter la latence sur la première requête
    logger.info("Pre-loading risk models...")
    try:
        from .models.risk_model import get_model, HAZARD_TYPES
        for hazard in HAZARD_TYPES:
            get_model(hazard)
        logger.info(f"Loaded {len(HAZARD_TYPES)} models")
    except Exception as e:
        logger.warning(f"Model pre-load partial failure: {e}")

    # Démarrer l'agent d'ingestion en arrière-plan
    from .agents.ingestion import run_ingestion_loop
    ingestion_task = asyncio.create_task(run_ingestion_loop())

    yield

    ingestion_task.cancel()
    try:
        await ingestion_task
    except asyncio.CancelledError:
        pass
    logger.info("AI prediction service shutting down")


app = FastAPI(
    title="SINAUR-RDC AI Prediction Service",
    description="Service de prédiction des risques de catastrophe pour la RDC",
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restreint par le réseau interne Docker
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "detail": str(exc)},
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "sinaur-rdc-ai-prediction",
        "version": "1.0.0",
    }


app.include_router(predictions_router)
app.include_router(internal_router)
app.include_router(veille_router)
app.include_router(antifraud_router)
app.include_router(connaissance_router)
