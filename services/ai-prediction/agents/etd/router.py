"""
Agent ETD — endpoints internes FastAPI.

Préfixe : /internal/etd
Auth    : X-Internal-API-Key (middleware global)
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, Query

from agents.etd.agent import etd_agent

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/etd", tags=["etd"])


@router.get("/{pcode}/analyse")
async def analyse_etd(
    pcode: str,
    days: int = Query(default=7, ge=1, le=90, description="Fenêtre d'analyse en jours"),
) -> dict:
    """
    Analyse locale de l'ETD : agrégation des signalements, tendance, zones critiques.
    """
    try:
        return await etd_agent.analyser_signalements_locaux(pcode, days=days)
    except Exception as exc:
        logger.error("etd_router.analyse.error", pcode=pcode, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{pcode}/rapport")
async def rapport_province(pcode: str) -> dict:
    """
    Génère automatiquement le rapport de situation que l'ETD transmet à la province.
    Agrège l'analyse, les besoins prioritaires, les incohérences et les seuils.
    """
    try:
        return await etd_agent.produire_rapport_province(pcode)
    except Exception as exc:
        logger.error("etd_router.rapport.error", pcode=pcode, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{pcode}/seuils")
async def seuils_etd(pcode: str) -> dict:
    """
    Vérifie les seuils d'alerte pour l'ETD.
    Retourne la liste des indicateurs avec leur valeur, le seuil et l'état de dépassement.
    """
    try:
        seuils = await etd_agent.verifier_seuils(pcode)
        nb_depasses = sum(1 for s in seuils if s.get("depasse"))
        return {
            "etd_pcode":      pcode,
            "seuils":         seuils,
            "nb_depasses":    nb_depasses,
            "alerte_active":  nb_depasses > 0,
        }
    except Exception as exc:
        logger.error("etd_router.seuils.error", pcode=pcode, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{pcode}/besoins")
async def besoins_etd(pcode: str) -> dict:
    """
    Identifie les besoins prioritaires de l'ETD, classés par score.
    """
    try:
        besoins = await etd_agent.identifier_besoins_prioritaires(pcode)
        return {"etd_pcode": pcode, "besoins": besoins}
    except Exception as exc:
        logger.error("etd_router.besoins.error", pcode=pcode, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{pcode}/incoherences")
async def incoherences_etd(pcode: str) -> dict:
    """
    Détecte les incohérences dans les données locales avant transmission à la province.
    """
    try:
        incoherences = await etd_agent.verifier_incoherences(pcode)
        return {
            "etd_pcode":   pcode,
            "incoherences": incoherences,
            "nb_total":    len(incoherences),
            "nb_elevees":  sum(1 for i in incoherences if i.get("gravite") == "ELEVEE"),
        }
    except Exception as exc:
        logger.error("etd_router.incoherences.error", pcode=pcode, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/flux/metriques")
async def metriques_flux(pcode: str | None = Query(default=None)) -> dict:
    """
    Métriques de performance du flux bidirectionnel.
    Mesure la rapidité de circulation de l'information = efficacité de l'État.
    """
    try:
        return await etd_agent.metriques_flux(etd_pcode=pcode)
    except Exception as exc:
        logger.error("etd_router.metriques.error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
