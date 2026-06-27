"""
Router Agent 9 — Endpoints conflit RBAC.

Auth : X-Internal-API-Key (middleware global) + X-User-Role header.
Le header X-User-Role est positionné par l'API Fastify lors de chaque proxy
vers ce service, en injectant le rôle de l'utilisateur authentifié par JWT.
Si absent, le niveau d'accès PUBLIC est appliqué par défaut.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Header, HTTPException, Query, status

from agents.conflit.agent import _CONVERGENCE_STORE, _EVENT_STORE, conflit_agent
from agents.conflit.data.armed_actors_rdc import ARMED_ACTORS_RDC
from agents.conflit.sanitizer import access_level_for_role, sanitize_conflict_event
from agents.conflit.schemas.conflict import (
    ConflictEvent,
    DataClassification,
)
from agents.conflit.sources.acled import resolve_actor

router = APIRouter(prefix="/internal/conflit", tags=["conflit"])

_RESTRICTED_ROLES = {
    "humanitarian_partner",
    "national_decision_maker",
    "system_admin",
}

_DISCLAIMER_PUBLIC = (
    "Sources : ACLED, OCHA, rapports publics MONUSCO, ICG. "
    "Usage humanitaire uniquement. Classification : RESTRICTED."
)


def _require_restricted(role: str) -> None:
    """Lève 403 si le rôle n'atteint pas RESTRICTED."""
    if access_level_for_role(role) < DataClassification.RESTRICTED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès RESTRICTED requis pour cet endpoint.",
        )


@router.get("/events")
async def get_conflict_events(
    province: str | None = None,
    since_days: int = 7,
    min_sources: int = Query(default=1, ge=1, le=4, description="Nombre minimum de sources distinctes pour inclure un événement"),
    x_user_role: str = Header(default="citizen", alias="X-User-Role"),
):
    """
    Événements de conflit filtrés selon le rôle et le niveau de corroboration.
    PUBLIC : province + sévérité + displacement_risk.
    RESTRICTED : acteurs nommés + coordonnées + notes brutes.
    min_sources : filtre corroboration (1=toutes, 2=confirmées, 3=haute fiabilité).
    """
    raw_events = conflit_agent.get_events(province=province, since_days=since_days)
    role = x_user_role.lower()

    result = []
    for raw in raw_events:
        # Filtre corroboration avant sérialisation RBAC
        if min_sources > 1 and raw.get("sources_count", 1) < min_sources:
            continue
        try:
            ev = ConflictEvent(**raw)
            result.append(sanitize_conflict_event(ev, role, raw=raw))
        except Exception:
            continue

    return {"events": result, "total": len(result)}


@router.get("/actors")
async def get_armed_actors(
    province: str | None = None,
    x_user_role: str = Header(default="citizen", alias="X-User-Role"),
):
    """
    Liste des acteurs armés documentés.
    Accès RESTRICTED uniquement.
    """
    _require_restricted(x_user_role.lower())

    actors = ARMED_ACTORS_RDC
    if province:
        actors = [
            a for a in actors
            if province in a["provinces_actives_historique"]
            or province in a.get("provinces_a_risque_expansion", [])
        ]

    return {
        "actors": actors,
        "total": len(actors),
        "_disclaimer": _DISCLAIMER_PUBLIC,
        "_last_updated": "2026-06-01",
    }


@router.get("/predictions/displacement")
async def get_displacement_predictions(
    province: str | None = None,
    x_user_role: str = Header(default="citizen", alias="X-User-Role"),
):
    """
    Prédictions de déplacement enrichies avec acteurs documentés.
    Accès RESTRICTED uniquement.
    """
    _require_restricted(x_user_role.lower())
    predictions = conflit_agent.get_predictions(province=province)
    return {"predictions": predictions, "total": len(predictions)}


@router.get("/map/public")
async def get_public_conflict_map():
    """
    Carte simplifiée PUBLIQUE — niveau de tension par province.
    Aucun nom de groupe, aucune coordonnée précise, aucun territoire.
    """
    data = conflit_agent.get_public_risk_map()
    return {
        "provinces": data,
        "total": len(data),
        "classification": "PUBLIC",
    }


@router.get("/map/operational")
async def get_operational_map(
    x_user_role: str = Header(default="citizen", alias="X-User-Role"),
):
    """
    Carte opérationnelle RESTRICTED — acteurs nommés, corridors, prédictions.
    """
    _require_restricted(x_user_role.lower())
    role = x_user_role.lower()

    events = conflit_agent.get_events(since_days=30)
    predictions = conflit_agent.get_predictions()

    sanitized_events = []
    for raw in events:
        try:
            ev = ConflictEvent(**raw)
            sanitized_events.append(sanitize_conflict_event(ev, role))
        except Exception:
            continue

    return {
        "events": sanitized_events,
        "predictions": predictions,
        "classification": "RESTRICTED",
        "_disclaimer": _DISCLAIMER_PUBLIC,
    }


@router.get("/data-sources")
async def conflit_data_sources():
    """
    Returns information about conflict data sources and their status.
    Includes setup instructions for obtaining data feeds from major providers.
    """
    return {
        "sources": [
            {
                "name": "ACLED (Armed Conflict Location & Event Data)",
                "status": "requires_api_key",
                "endpoint": "https://api.acleddata.com/acled/read",
                "instructions": (
                    "Register at https://acleddata.com/register/ for free academic/NGO access. "
                    "Set ACLED_API_KEY and ACLED_ACCESS_EMAIL in environment variables."
                ),
                "coverage": "Daily updates, all conflict event types, geocoded to village level",
                "priority": "HIGH",
            },
            {
                "name": "OCHA ReliefWeb (Conflict Reports)",
                "status": "active",
                "source_id": "reliefweb_conflict",
                "coverage": "3-hour cycle, conflict-tagged reports for COD",
                "priority": "MEDIUM",
            },
            {
                "name": "MONUSCO Situation Reports",
                "status": "requires_integration",
                "instructions": (
                    "MONUSCO publishes SitReps at https://monusco.unmissions.org "
                    "— contact for data sharing agreement"
                ),
                "priority": "HIGH",
            },
            {
                "name": "Disaster Events DB (bootstrap)",
                "status": "active",
                "coverage": "All conflict/displacement events entered by operators in the last 30 days",
                "priority": "ACTIVE",
            },
        ],
        "recommendation": (
            "For operational conflict data, the highest priority is obtaining an ACLED API key "
            "(free for humanitarian organizations). ACLED covers RDC in near-real-time with "
            "actor resolution."
        ),
        "current_events_count": len(_EVENT_STORE),
    }


@router.get("/previsions")
async def get_previsions(
    horizon: int = Query(default=3, ge=1, le=36, description="Horizon en mois"),
):
    """
    Prévisions VIEWS agrégées par province (grilles PRIO-GRID → province).
    Retourne les provinces triées par probabilité de conflit décroissante.
    Données prédictives — à distinguer des incidents réels.
    """
    try:
        from db import engine
        from sqlalchemy import text as sa_text
        async with engine.connect() as conn:
            rows = await conn.execute(sa_text("""
                SELECT
                    pred_pcode,
                    province_nom,
                    MIN(mois_cible)              AS mois_cible,
                    horizon_mois,
                    ROUND(AVG(probabilite)::numeric, 3)          AS probabilite_moy,
                    ROUND(MAX(probabilite)::numeric, 3)          AS probabilite_max,
                    ROUND(SUM(morts_predites)::numeric, 1)       AS morts_predites_total,
                    COUNT(*)                     AS grilles_count,
                    MAX(recupere_le)             AS derniere_mise_a_jour
                FROM prevision_conflit
                WHERE source = 'VIEWS'
                  AND horizon_mois = :horizon
                  AND mois_cible >= CURRENT_DATE
                GROUP BY pred_pcode, province_nom, horizon_mois
                ORDER BY probabilite_max DESC
            """), {"horizon": horizon})

            previsions = []
            derniere_maj: str | None = None
            for row in rows:
                r = dict(row._mapping)
                r["mois_cible"] = str(r["mois_cible"]) if r["mois_cible"] else None
                r["derniere_mise_a_jour"] = str(r["derniere_mise_a_jour"]) if r["derniere_mise_a_jour"] else None
                r["probabilite_moy"] = float(r["probabilite_moy"] or 0)
                r["probabilite_max"] = float(r["probabilite_max"] or 0)
                r["morts_predites_total"] = float(r["morts_predites_total"] or 0)
                r["grilles_count"] = int(r["grilles_count"] or 0)
                r["source"] = "VIEWS"
                if derniere_maj is None:
                    derniere_maj = r["derniere_mise_a_jour"]
                previsions.append(r)

        return {
            "previsions": previsions,
            "source": "VIEWS (Uppsala University / PRIO)",
            "note": "Prévisions de conflit, pas des incidents réels. Modèle PRIO-GRID 55×55km.",
            "horizon_mois": horizon,
            "derniere_mise_a_jour": derniere_maj,
            "total": len(previsions),
        }
    except Exception as exc:
        logger.error("conflit.previsions_failed", error=str(exc))
        return {
            "previsions": [],
            "source": "VIEWS",
            "horizon_mois": horizon,
            "total": 0,
            "error": str(exc),
        }


@router.get("/previsions/fiabilite")
async def get_previsions_fiabilite(
    province_pcode: str | None = None,
):
    """
    Taux de réussite historique des prévisions VIEWS — global ou par province.
    Calculé a posteriori : prévisions passées vs incidents réels (conflict_event_raw).
    """
    from agents.conflit.auto_evaluation import taux_reussite
    return await taux_reussite(province_pcode)


@router.post("/previsions/evaluer")
async def declencher_evaluation():
    """
    Déclenche immédiatement l'évaluation des prévisions VIEWS arrivées à échéance.
    Utile pour forcer l'évaluation après import d'incidents historiques.
    """
    from agents.conflit.auto_evaluation import evaluer_previsions_echeues
    n = await evaluer_previsions_echeues()
    return {"evaluated": n, "ok": True}


@router.get("/convergences")
async def get_convergences(
    niveau: str | None = Query(default=None, description="Filtrer par niveau: CONVERGENCE_CRITIQUE, ALERTE_RENFORCEE, VIGILANCE"),
):
    """
    Alertes de convergence VIEWS + terrain (calculées toutes les 2h).
    Détecte quand une prévision macro (VIEWS) et des incidents terrain récents convergent.
    """
    if _CONVERGENCE_STORE:
        alertes = list(_CONVERGENCE_STORE)
    else:
        # Calcul à la demande si le store est vide (démarrage froid)
        from agents.conflit.convergence import detecter_convergences
        alertes = await detecter_convergences()
        _CONVERGENCE_STORE.clear()
        _CONVERGENCE_STORE.extend(alertes)

    if niveau:
        alertes = [a for a in alertes if a["niveau"] == niveau.upper()]

    return {
        "alertes": alertes,
        "total": len(alertes),
        "critiques": sum(1 for a in alertes if a["niveau"] == "CONVERGENCE_CRITIQUE"),
        "renforcees": sum(1 for a in alertes if a["niveau"] == "ALERTE_RENFORCEE"),
        "vigilances": sum(1 for a in alertes if a["niveau"] == "VIGILANCE"),
        "calcule_le": alertes[0]["calcule_le"] if alertes else None,
    }


@router.post("/reload")
async def reload_events():
    """Force re-bootstrap from disaster_events DB. Clears store first."""
    _EVENT_STORE.clear()
    await conflit_agent._bootstrap_from_db()
    return {"events_loaded": len(_EVENT_STORE), "ok": True}


@router.post("/actors/resolve")
async def resolve_actor_endpoint(
    body: dict,
    x_user_role: str = Header(default="citizen", alias="X-User-Role"),
):
    """
    Résout un nom d'acteur ACLED vers le référentiel interne.
    Accès RESTRICTED uniquement.
    """
    _require_restricted(x_user_role.lower())
    name = body.get("name", "")
    zone = body.get("zone_operation", "")
    actor = resolve_actor(name, zone)
    if actor is None:
        raise HTTPException(status_code=404, detail="Nom d'acteur vide ou invalide.")
    return actor.model_dump(exclude={"classification"})
