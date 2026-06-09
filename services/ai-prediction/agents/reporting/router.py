"""
Reporting agent internal API endpoints.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from agents.reporting.agent import reporting_agent

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/reporting", tags=["reporting"])


class GenerateRequest(BaseModel):
    report_type: str
    params: dict = {}


@router.post("/generate")
async def generate_report(request: GenerateRequest) -> dict:
    """
    Génère un rapport à la demande.

    report_type supportés :
      - "daily_bulletin"  — bulletin opérationnel quotidien
      - "weekly_summary"  — résumé exécutif hebdomadaire
      - "provincial"      — rapport provincial (params: {"pcode": "CD-NK"})
    """
    try:
        result = await reporting_agent.generate_on_demand(
            report_type=request.report_type,
            params=request.params,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("reporting_router.generate_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/reports")
async def list_reports(
    type: str | None = Query(default=None, description="Filtrer par type de rapport"),
) -> list[dict]:
    """
    Retourne la liste des rapports générés, avec filtre optionnel par type.
    Types : daily_bulletin, weekly_summary, provincial.
    """
    try:
        return reporting_agent.get_reports(report_type=type)
    except Exception as exc:
        logger.error("reporting_router.list_reports_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/reports/{report_id}")
async def get_report(report_id: str) -> dict:
    """
    Retourne un rapport par son identifiant unique.
    Retourne 404 si le rapport est introuvable.
    """
    report = reporting_agent.get_report(report_id)
    if report is None:
        raise HTTPException(
            status_code=404,
            detail=f"Rapport '{report_id}' introuvable.",
        )
    return report


@router.get("/hxl/latest", response_class=PlainTextResponse)
async def get_latest_hxl() -> str:
    """
    Retourne le dernier export HXL en format CSV texte brut.
    Les données sont anonymisées (agrégées par P-code, sans identifiant individuel).
    """
    hxl = reporting_agent.get_latest_hxl()
    if not hxl:
        raise HTTPException(
            status_code=404,
            detail="Aucun export HXL disponible. Générez d'abord un bulletin quotidien.",
        )
    return PlainTextResponse(content=hxl, media_type="text/csv; charset=utf-8")


@router.get("/hxl/history")
async def get_hxl_history() -> list[dict]:
    """
    Retourne l'historique des exports HXL générés
    (métadonnées uniquement : date, report_id, taille).
    """
    try:
        return reporting_agent.get_hxl_history()
    except Exception as exc:
        logger.error("reporting_router.hxl_history_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
