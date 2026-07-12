"""
SINAUR-RDC AI Prediction Service — top-level FastAPI application.

Starts 12 agents:
  1. VeilleAgent         — data ingestion from ReliefWeb, Open-Meteo, FEWS NET, OCHA HDX, Mettelsat
  2. PredictionAgent     — risk scoring (26 provinces × 4 risk types, 6h cadence)
  3. AntiFraudAgent      — beneficiary dossier fraud/deduplication (on-demand via API)
  4. AnomalieStocksAgent — stock movement anomaly detection (8 patterns, real-time)
  5. SignalementsAgent   — multilingual citizen report classification & geo-clustering
  6. ReportingAgent      — daily bulletins, executive summaries, HXL exports
  7. LogistiqueAgent     — warehouse↔disaster resource allocation, OSRM routing
  8. EpidemieAgent       — epidemic cluster detection (7 maladies : Ebola, Choléra, Mpox…)
  9. ConflitAgent        — armed conflict surveillance, displacement prediction (RESTRICTED)
 10. RenseignementAgent  — military & security intelligence, threat assessment (RESTRICTED)
 11. AgentCatastrophes  — catastrophes naturelles GDACS (séismes, inondations, volcans…)
 12. AgentResponsables  — veille presse nominations (Actualité.cd, Radio Okapi…)

All /internal/* routes require X-Internal-API-Key header.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from agents.anomalie_stocks.router import router as anomalie_stocks_router
from agents.antifraud.router import router as antifraud_router
from agents.auto_crisis.router import router as auto_crisis_router
from agents.conflit.router import router as conflit_router
from agents.etd.router import router as etd_router
from agents.renseignement.router import router as renseignement_router
from agents.epidemie.router import router as epidemie_router
from agents.logistique.router import router as logistique_router
from agents.prediction.router import router as prediction_router
from agents.reporting.router import router as reporting_router
from agents.signalements.router import router as signalements_router
from agents.veille.router import router as veille_router
from agents.virus_emergents.router import router as virus_emergents_router
from agents.catastrophes.router import router as catastrophes_router
from agents.responsables.router import router as responsables_router
from agents.connaissance.router import router as connaissance_router
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

    # Start Anomalie Stocks agent (stock surveillance)
    try:
        from agents.anomalie_stocks.agent import anomalie_stocks_agent
        await anomalie_stocks_agent.start()
        logger.info("lifespan.anomalie_stocks_agent_started")
    except Exception as exc:
        logger.warning("lifespan.anomalie_stocks_agent_start_failed", error=str(exc))

    # Start Logistique agent (resource allocation optimization)
    try:
        from agents.logistique.agent import logistique_agent
        await logistique_agent.start()
        logger.info("lifespan.logistique_agent_started")
    except Exception as exc:
        logger.warning("lifespan.logistique_agent_start_failed", error=str(exc))

    # Start Reporting agent (daily bulletins, HXL exports)
    try:
        from agents.reporting.agent import reporting_agent
        await reporting_agent.start()
        logger.info("lifespan.reporting_agent_started")
    except Exception as exc:
        logger.warning("lifespan.reporting_agent_start_failed", error=str(exc))

    # Start Epidemie agent (epidemic cluster detection)
    try:
        from agents.epidemie.agent import epidemie_agent
        await epidemie_agent.start()
        logger.info("lifespan.epidemie_agent_started")
    except Exception as exc:
        logger.warning("lifespan.epidemie_agent_start_failed", error=str(exc))

    # Start OMS Scraper agent (WHO/ReliefWeb/HDX epidemic data — every 4h)
    try:
        from agents.epidemie.oms_scraper import oms_scraper_agent
        await oms_scraper_agent.start()
        logger.info("lifespan.oms_scraper_agent_started")
    except Exception as exc:
        logger.warning("lifespan.oms_scraper_agent_start_failed", error=str(exc))

    # Start AutoCrisisEngine (automatic crisis creation from multi-source reports)
    try:
        from agents.auto_crisis.engine import auto_crisis_engine
        await auto_crisis_engine.start()
        logger.info("lifespan.auto_crisis_engine_started")
    except Exception as exc:
        logger.warning("lifespan.auto_crisis_engine_start_failed", error=str(exc))

    # Start VirusEmergentAgent (emerging pathogen surveillance — 8 sources)
    try:
        from agents.virus_emergents.agent import virus_emergent_agent
        await virus_emergent_agent.start()
        logger.info("lifespan.virus_emergent_agent_started")
    except Exception as exc:
        logger.warning("lifespan.virus_emergent_agent_start_failed", error=str(exc))

    # Start DetecteurEmergence (signal faible pathogènes inconnus — cycle 2h)
    try:
        from agents.epidemie.detecteur_emergence import detecteur_emergence
        await detecteur_emergence.start()
        logger.info("lifespan.detecteur_emergence_started")
    except Exception as exc:
        logger.warning("lifespan.detecteur_emergence_start_failed", error=str(exc))

    # Start AgentCatastrophes (GDACS — catastrophes naturelles, cycle 30min)
    try:
        from agents.catastrophes.agent import agent_catastrophes
        await agent_catastrophes.start()
        logger.info("lifespan.agent_catastrophes_started")
    except Exception as exc:
        logger.warning("lifespan.agent_catastrophes_start_failed", error=str(exc))

    # Start Conflit agent (armed conflict surveillance + displacement prediction)
    try:
        from agents.conflit.agent import conflit_agent
        await conflit_agent.start()
        logger.info("lifespan.conflit_agent_started")
    except Exception as exc:
        logger.warning("lifespan.conflit_agent_start_failed", error=str(exc))

    # Start Renseignement agent (military & security intelligence)
    try:
        from agents.renseignement.agent import renseignement_agent
        await renseignement_agent.start()
        logger.info("lifespan.renseignement_agent_started")
    except Exception as exc:
        logger.warning("lifespan.renseignement_agent_start_failed", error=str(exc))

    # Start AgentResponsables (veille presse nominations — cycle 12h)
    try:
        from agents.responsables.agent import agent_responsables
        await agent_responsables.start()
        logger.info("lifespan.agent_responsables_started")
    except Exception as exc:
        logger.warning("lifespan.agent_responsables_start_failed", error=str(exc))

    # Start ConnaissanceAgent (moteur de connaissance évolutif — cycle 4h)
    try:
        from agents.connaissance.agent import connaissance_agent
        await connaissance_agent.start()
        logger.info("lifespan.connaissance_agent_started")
    except Exception as exc:
        logger.warning("lifespan.connaissance_agent_start_failed", error=str(exc))

    # Charger les fiches RAG initiales si la bibliothèque est vide
    try:
        from agents.connaissance.rag_initiale import charger_fiches_initiales
        await charger_fiches_initiales()
        logger.info("lifespan.rag_initiale_ok")
    except Exception as exc:
        logger.warning("lifespan.rag_initiale_failed", error=str(exc))

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

    try:
        from agents.anomalie_stocks.agent import anomalie_stocks_agent
        await anomalie_stocks_agent.stop()
    except Exception:
        pass

    try:
        from agents.logistique.agent import logistique_agent
        await logistique_agent.stop()
    except Exception:
        pass

    try:
        from agents.reporting.agent import reporting_agent
        await reporting_agent.stop()
    except Exception:
        pass

    try:
        from agents.epidemie.agent import epidemie_agent
        await epidemie_agent.stop()
    except Exception:
        pass

    try:
        from agents.epidemie.oms_scraper import oms_scraper_agent
        await oms_scraper_agent.stop()
    except Exception:
        pass

    try:
        from agents.epidemie.detecteur_emergence import detecteur_emergence
        await detecteur_emergence.stop()
    except Exception:
        pass

    try:
        from agents.catastrophes.agent import agent_catastrophes
        await agent_catastrophes.stop()
    except Exception:
        pass

    try:
        from agents.conflit.agent import conflit_agent
        await conflit_agent.stop()
    except Exception:
        pass

    try:
        from agents.renseignement.agent import renseignement_agent
        await renseignement_agent.stop()
    except Exception:
        pass

    try:
        from agents.responsables.agent import agent_responsables
        await agent_responsables.stop()
    except Exception:
        pass

    try:
        from agents.auto_crisis.engine import auto_crisis_engine
        await auto_crisis_engine.stop()
    except Exception:
        pass

    try:
        from agents.virus_emergents.agent import virus_emergent_agent
        await virus_emergent_agent.stop()
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
app.include_router(anomalie_stocks_router)
app.include_router(signalements_router)
app.include_router(reporting_router)
app.include_router(logistique_router)
app.include_router(epidemie_router)
app.include_router(conflit_router)
app.include_router(etd_router)
app.include_router(renseignement_router)
app.include_router(auto_crisis_router)
app.include_router(virus_emergents_router)
app.include_router(catastrophes_router)
app.include_router(responsables_router)
app.include_router(connaissance_router)


# --- Unified agents status endpoint ---

@app.get("/internal/agents/status", tags=["agents"])
async def agents_status():
    """
    Returns the current status of all 8 AI agents in a single call.
    Target response time: < 500ms (all data from memory, no DB calls).
    """
    import time
    t0 = time.monotonic()

    agents: list[dict] = []

    def _agent_entry(
        id: str,
        name: str,
        description: str,
        *,
        last_run: str | None = None,
        next_run: str | None = None,
        metrics: dict | None = None,
        status: str = "ok",
    ) -> dict:
        return {
            "id": id,
            "name": name,
            "description": description,
            "status": status,
            "last_run": last_run,
            "next_run": next_run,
            "metrics": metrics or {},
        }

    # Agent 1 — Veille
    try:
        from agents.veille.agent import veille_agent, _CONNECTOR_HEALTH
        health = veille_agent.get_health()
        n_ok = sum(1 for c in health.get("connectors", []) if c.get("healthy") is True)
        total_c = len(health.get("connectors", []))
        agents.append(_agent_entry(
            "veille", "Veille & Ingestion",
            "Collecte multi-sources (ReliefWeb, FEWS NET, GDACS, Open-Meteo, METTELSAT)",
            metrics={"connectors_ok": n_ok, "connectors_total": total_c, "events_stored": health.get("total_events", 0)},
            status="ok" if n_ok == total_c else ("degraded" if n_ok > 0 else "error"),
        ))
    except Exception as exc:
        agents.append(_agent_entry("veille", "Veille & Ingestion", "", status="error", metrics={"error": str(exc)}))

    # Agent 2 — Prédiction
    try:
        from agents.prediction.agent import _RISK_STORE
        agents.append(_agent_entry(
            "prediction", "Prédiction des Risques",
            "Scoring 26 provinces × 4 aléas × horizons 7/30/90j",
            metrics={"risk_scores_stored": len(_RISK_STORE)},
        ))
    except Exception as exc:
        agents.append(_agent_entry("prediction", "Prédiction des Risques", "", status="error", metrics={"error": str(exc)}))

    # Agent 3 — Anti-Fraude
    try:
        from agents.antifraud.agent import REVIEW_QUEUE, _ALL_RESULTS
        agents.append(_agent_entry(
            "antifraud", "Anti-Fraude & Déduplication",
            "Détection fraude dossiers sinistrés, déduplication Jaro-Winkler",
            metrics={"review_queue": len(REVIEW_QUEUE), "total_processed": len(_ALL_RESULTS)},
        ))
    except Exception as exc:
        agents.append(_agent_entry("antifraud", "Anti-Fraude & Déduplication", "", status="error", metrics={"error": str(exc)}))

    # Agent 4 — Anomalie Stocks
    try:
        from agents.anomalie_stocks.agent import anomalie_stocks_agent, _ANOMALY_STORE
        dashboard = anomalie_stocks_agent.get_dashboard()
        agents.append(_agent_entry(
            "anomalie_stocks", "Détection d'Anomalies Stocks",
            "Surveillance mouvements stocks temps réel (8 patterns, fenêtres 1h/6h/24h)",
            metrics={"total_anomalies": len(_ANOMALY_STORE), "critical": dashboard.get("by_level", {}).get("CRITICAL", 0), "unresolved": dashboard.get("unresolved", 0)},
        ))
    except Exception as exc:
        agents.append(_agent_entry("anomalie_stocks", "Détection d'Anomalies Stocks", "", status="error", metrics={"error": str(exc)}))

    # Agent 5 — Signalements
    try:
        from agents.signalements.agent import signalements_agent, _SIGNALEMENT_STORE
        stats = signalements_agent.get_stats()
        agents.append(_agent_entry(
            "signalements", "Traitement des Signalements Citoyens",
            "Classification NLP multilingue (FR/SW/LN/KG/TS), clustering géo-temporel",
            metrics={"total": len(_SIGNALEMENT_STORE), "clusters": stats.get("cluster_count", 0)},
        ))
    except Exception as exc:
        agents.append(_agent_entry("signalements", "Traitement des Signalements Citoyens", "", status="error", metrics={"error": str(exc)}))

    # Agent 6 — Reporting
    try:
        from agents.reporting.agent import reporting_agent, _REPORTS_STORE
        agents.append(_agent_entry(
            "reporting", "Synthèse & Reporting",
            "Bulletins quotidiens, résumés exécutifs, exports HXL humanitaires",
            metrics={"reports_generated": len(_REPORTS_STORE)},
        ))
    except Exception as exc:
        agents.append(_agent_entry("reporting", "Synthèse & Reporting", "", status="error", metrics={"error": str(exc)}))

    # Agent 7 — Logistique
    try:
        from agents.logistique.agent import logistique_agent, _RECOMMENDATIONS
        recs = logistique_agent.get_recommendations()
        pending = sum(1 for r in recs if r.get("status") == "PENDING")
        agents.append(_agent_entry(
            "logistique", "Optimisation Logistique",
            "Allocation entrepôts↔sinistres, OSRM routing, suggestions validateur",
            metrics={"total_recommendations": len(_RECOMMENDATIONS), "pending": pending},
        ))
    except Exception as exc:
        agents.append(_agent_entry("logistique", "Optimisation Logistique", "", status="error", metrics={"error": str(exc)}))

    # Agent 8 — Épidémie
    try:
        from agents.epidemie.agent import epidemie_agent, _CLUSTER_STORE, _ALERT_STORE
        agents.append(_agent_entry(
            "epidemie", "Surveillance Épidémique",
            "Détection clusters sanitaires (Choléra/Mpox/Rougeole/Méningite/Ebola), alertes CAP Health",
            metrics={"active_clusters": len(_CLUSTER_STORE), "active_alerts": len(_ALERT_STORE)},
        ))
    except Exception as exc:
        agents.append(_agent_entry("epidemie", "Surveillance Épidémique", "", status="error", metrics={"error": str(exc)}))

    # Agent 8b — OMS Scraper
    try:
        from agents.epidemie.oms_scraper import oms_scraper_agent
        st = oms_scraper_agent.get_status()
        has_errors = bool(st.get("errors"))
        agents.append(_agent_entry(
            "oms_scraper", "Scraper OMS/ReliefWeb/HDX",
            "Surveillance épidémique officielle — WHO DON RSS, ReliefWeb Health, OCHA HDX (cadence 4h)",
            last_run=st.get("last_run"),
            metrics={
                "runs_total": st.get("runs_total", 0),
                "timeseries_updated": st.get("timeseries_updated", 0),
                "zones_updated": st.get("zones_updated", 0),
                "last_results": st.get("last_results", {}),
                "errors": st.get("errors", []),
            },
            status="degraded" if has_errors else "ok",
        ))
    except Exception as exc:
        agents.append(_agent_entry("oms_scraper", "Scraper OMS/ReliefWeb/HDX", "", status="error", metrics={"error": str(exc)}))

    # Agent 9 — Conflit
    try:
        from agents.conflit.agent import conflit_agent, _EVENT_STORE, _PREDICTION_STORE
        agents.append(_agent_entry(
            "conflit", "Surveillance des Conflits Armés",
            "Résolution acteurs ACLED, prédiction déplacements, carte opérationnelle RESTRICTED",
            metrics={"events_stored": len(_EVENT_STORE), "predictions": len(_PREDICTION_STORE)},
        ))
    except Exception as exc:
        agents.append(_agent_entry("conflit", "Surveillance des Conflits Armés", "", status="error", metrics={"error": str(exc)}))

    # Agent 10 — Renseignement
    try:
        from agents.renseignement.agent import renseignement_agent, _EVENT_STORE as _RENS_EVENTS, _ASSESSMENT_STORE, _BULLETIN_STORE
        agents.append(_agent_entry(
            "renseignement", "Renseignement Militaire & Sécuritaire",
            "Surveillance Radio Okapi + ACLED deep, évaluation menace 26 provinces, bulletins RESTRICTED",
            metrics={"events_stored": len(_RENS_EVENTS), "assessments": len(_ASSESSMENT_STORE), "has_bulletin": bool(_BULLETIN_STORE)},
        ))
    except Exception as exc:
        agents.append(_agent_entry("renseignement", "Renseignement Militaire & Sécuritaire", "", status="error", metrics={"error": str(exc)}))

    elapsed_ms = round((time.monotonic() - t0) * 1000, 1)
    overall = "ok" if all(a["status"] == "ok" for a in agents) else (
        "degraded" if any(a["status"] != "error" for a in agents) else "error"
    )

    return {
        "status": overall,
        "agents": agents,
        "agent_count": len(agents),
        "response_ms": elapsed_ms,
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }
