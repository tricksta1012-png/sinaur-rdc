"""
Reporting agent internal API endpoints.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from agents.reporting.agent import reporting_agent
from config import settings

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


@router.post("/publish/hdx")
async def publish_to_hdx() -> dict:
    """
    Exports the latest HXL data as a CSV and notifies that it's ready.

    If HDX_API_KEY is configured, attempts to publish to the Humanitarian
    Data Exchange (data.humdata.org).  If not configured, returns the local
    download URL so the dataset can be uploaded manually.
    """
    now = datetime.now(timezone.utc).isoformat()
    local_url = "/internal/reporting/hxl/latest"

    hxl = reporting_agent.get_latest_hxl()
    if not hxl:
        # No cached HXL — generate a bulletin on the fly
        try:
            await reporting_agent.generate_daily_bulletin()
            hxl = reporting_agent.get_latest_hxl()
        except Exception as gen_exc:
            logger.error("reporting_router.hdx_generate_error", error=str(gen_exc))

    if not settings.hdx_api_key:
        return {
            "export_ready": True,
            "download_url": local_url,
            "note": "HDX API key not configured — manual upload required. "
                    "Set HDX_API_KEY environment variable.",
            "generated_at": now,
        }

    # Attempt HDX dataset resource update
    hdx_url = "https://data.humdata.org/api/action/resource_update"
    headers = {
        "X-CKAN-API-Key": settings.hdx_api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "name": "sinaur-rdc-hxl-export",
        "description": f"SINAUR-RDC HXL export generated {now}",
        "format": "CSV",
        "upload": hxl,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(hdx_url, json=payload, headers=headers)
            if resp.status_code == 200:
                result = resp.json()
                return {
                    "export_ready": True,
                    "published_to_hdx": True,
                    "hdx_result": result,
                    "download_url": local_url,
                    "generated_at": now,
                }
            else:
                logger.warning(
                    "reporting_router.hdx_publish_failed",
                    status_code=resp.status_code,
                    body=resp.text[:500],
                )
                return {
                    "export_ready": True,
                    "published_to_hdx": False,
                    "download_url": local_url,
                    "hdx_error": f"HDX returned HTTP {resp.status_code}",
                    "generated_at": now,
                }
    except Exception as exc:
        logger.error("reporting_router.hdx_publish_error", error=str(exc))
        return {
            "export_ready": True,
            "published_to_hdx": False,
            "download_url": local_url,
            "hdx_error": str(exc),
            "generated_at": now,
        }


@router.post("/publish/reliefweb")
async def publish_to_reliefweb() -> dict:
    """
    Submits a situation report to ReliefWeb.

    Requires RELIEFWEB_API_KEY to be configured.  Without it, returns
    instructions for obtaining credentials and a local export URL.
    """
    now = datetime.now(timezone.utc).isoformat()
    export_url = "/internal/reporting/hxl/latest"

    if not settings.reliefweb_api_key:
        return {
            "published": False,
            "reason": "RELIEFWEB_API_KEY not configured",
            "instructions": (
                "Contact api@reliefweb.int to obtain API credentials for the "
                "DRC national authority (SINAUR-RDC). Once granted, set the "
                "RELIEFWEB_API_KEY environment variable."
            ),
            "export_url": export_url,
            "generated_at": now,
        }

    # Fetch latest daily bulletin
    reports = reporting_agent.get_reports(report_type="daily_bulletin")
    if not reports:
        try:
            latest_report = await reporting_agent.generate_daily_bulletin()
        except Exception as gen_exc:
            logger.error("reporting_router.reliefweb_generate_error", error=str(gen_exc))
            raise HTTPException(status_code=500, detail=str(gen_exc))
    else:
        latest_report = reports[-1]

    report_title = f"SINAUR-RDC Daily Bulletin — {latest_report.get('generated_at', now)[:10]}"
    report_body = (
        f"Bulletin opérationnel quotidien SINAUR-RDC.\n"
        f"Période : {latest_report.get('period_start', '')} — {latest_report.get('period_end', '')}.\n"
        f"Événements DB : {latest_report.get('db_events_count', 0)}.\n"
        f"Signalements 24h : {latest_report.get('nouveaux_signalements_24h', {}).get('total', 0)}."
    )

    payload = {
        "appname": settings.reliefweb_app_name,
        "title": report_title,
        "body": report_body,
        "country": [{"iso3": "COD"}],
        "theme": [{"name": "Disaster Management"}],
        "format": [{"name": "Situation Report"}],
        "status": "published",
    }

    rw_url = "https://api.reliefweb.int/v1/reports"
    headers = {
        "Authorization": f"Bearer {settings.reliefweb_api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(rw_url, json=payload, headers=headers)
            if resp.status_code in (200, 201):
                result = resp.json()
                logger.info("reporting_router.reliefweb_published", report_id=latest_report.get("report_id"))
                return {
                    "published": True,
                    "reliefweb_result": result,
                    "report_id": latest_report.get("report_id"),
                    "generated_at": now,
                }
            else:
                logger.warning(
                    "reporting_router.reliefweb_publish_failed",
                    status_code=resp.status_code,
                    body=resp.text[:500],
                )
                return {
                    "published": False,
                    "reason": f"ReliefWeb returned HTTP {resp.status_code}",
                    "export_url": export_url,
                    "generated_at": now,
                }
    except Exception as exc:
        logger.error("reporting_router.reliefweb_publish_error", error=str(exc))
        return {
            "published": False,
            "reason": str(exc),
            "export_url": export_url,
            "generated_at": now,
        }
