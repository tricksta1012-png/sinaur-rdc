"""
Router Agent 9 — Endpoints conflit RBAC.

Auth : X-Internal-API-Key (middleware global) + X-User-Role header.
Le header X-User-Role est positionné par l'API Fastify lors de chaque proxy
vers ce service, en injectant le rôle de l'utilisateur authentifié par JWT.
Si absent, le niveau d'accès PUBLIC est appliqué par défaut.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, status

from agents.conflit.agent import conflit_agent
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
    x_user_role: str = Header(default="citizen", alias="X-User-Role"),
):
    """
    Événements de conflit filtrés selon le rôle.
    PUBLIC : province + sévérité + displacement_risk.
    RESTRICTED : acteurs nommés + coordonnées + notes brutes.
    """
    raw_events = conflit_agent.get_events(province=province, since_days=since_days)
    role = x_user_role.lower()

    result = []
    for raw in raw_events:
        try:
            ev = ConflictEvent(**raw)
            result.append(sanitize_conflict_event(ev, role))
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
