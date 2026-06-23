"""
AgentResponsables — endpoints internes.
Toutes les routes requièrent X-Internal-API-Key.
"""
from __future__ import annotations

import asyncio
from typing import Optional

import asyncpg
import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from config import settings
from .agent import agent_responsables

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/internal/responsables", tags=["responsables"])

# Pool dédié au router (lectures uniquement)
_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    """Retourne (ou crée) le pool asyncpg du router."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=1,
            max_size=3,
        )
    return _pool


# ── GET /propositions ─────────────────────────────────────────────────────────

@router.get("/propositions")
async def get_propositions(
    statut: str = Query('A_VALIDER', description="A_VALIDER | VALIDEE | REJETEE"),
    pcode: Optional[str] = Query(None, description="Filtrer par pcode admin"),
    limit: int = Query(50, ge=1, le=500, description="Nombre max de résultats"),
) -> dict:
    """Liste les propositions de nomination en attente de validation."""
    STATUTS_VALIDES = {'A_VALIDER', 'VALIDEE', 'REJETEE'}
    if statut not in STATUTS_VALIDES:
        raise HTTPException(400, f"Statut invalide. Valides : {sorted(STATUTS_VALIDES)}")

    try:
        pool = await get_pool()
        if pcode:
            rows = await pool.fetch(
                """
                SELECT id, pcode, entite_nom, personne, fonction, type_acte,
                       date_acte, interimaire, remplace, source, url_article,
                       confiance, statut_rapprochement, candidats, statut,
                       created_at
                FROM responsable_proposition
                WHERE statut = $1 AND pcode = $2
                ORDER BY created_at DESC
                LIMIT $3
                """,
                statut,
                pcode,
                limit,
            )
        else:
            rows = await pool.fetch(
                """
                SELECT id, pcode, entite_nom, personne, fonction, type_acte,
                       date_acte, interimaire, remplace, source, url_article,
                       confiance, statut_rapprochement, candidats, statut,
                       created_at
                FROM responsable_proposition
                WHERE statut = $1
                ORDER BY created_at DESC
                LIMIT $2
                """,
                statut,
                limit,
            )

        propositions = []
        for row in rows:
            d = dict(row)
            # Sérialise date_acte et created_at en string
            if d.get('date_acte') is not None:
                d['date_acte'] = str(d['date_acte'])
            if d.get('created_at') is not None:
                d['created_at'] = d['created_at'].isoformat()
            propositions.append(d)

        return {'total': len(propositions), 'propositions': propositions}

    except Exception as exc:
        logger.error("responsables_router.propositions_error", error=str(exc))
        raise HTTPException(500, str(exc))


# ── GET /status ───────────────────────────────────────────────────────────────

@router.get("/status")
async def get_status() -> dict:
    """Statut opérationnel de l'AgentResponsables."""
    try:
        return agent_responsables.get_status()
    except Exception as exc:
        logger.error("responsables_router.status_error", error=str(exc))
        raise HTTPException(500, str(exc))


# ── POST /propositions ────────────────────────────────────────────────────────

class PropositionIn(BaseModel):
    pcode: Optional[str] = None
    entite_nom: Optional[str] = None
    personne: str
    fonction: Optional[str] = None
    type_acte: Optional[str] = None
    date_acte: Optional[str] = None
    interimaire: bool = False
    remplace: Optional[str] = None
    source: Optional[str] = None
    url_article: Optional[str] = None
    confiance: Optional[float] = None
    statut_rapprochement: str = 'CERTAIN'


@router.post("/propositions", status_code=201)
async def create_proposition(payload: PropositionIn) -> dict:
    """
    Injection manuelle d'une proposition de nomination (tests / saisie opérateur).
    """
    try:
        pool = await get_pool()

        date_acte = None
        if payload.date_acte:
            try:
                from datetime import date
                date_acte = date.fromisoformat(payload.date_acte)
            except Exception:
                date_acte = None

        row = await pool.fetchrow(
            """
            INSERT INTO responsable_proposition
              (pcode, entite_nom, personne, fonction, type_acte, date_acte,
               interimaire, remplace, source, url_article, confiance,
               statut_rapprochement, candidats, detail)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL)
            RETURNING id, created_at
            """,
            payload.pcode,
            payload.entite_nom,
            payload.personne,
            payload.fonction,
            payload.type_acte,
            date_acte,
            payload.interimaire,
            payload.remplace,
            payload.source,
            payload.url_article,
            payload.confiance,
            payload.statut_rapprochement,
        )

        return {
            'id': row['id'],
            'created_at': row['created_at'].isoformat() if row['created_at'] else None,
            'personne': payload.personne,
            'statut': 'A_VALIDER',
        }

    except Exception as exc:
        logger.error("responsables_router.create_error", error=str(exc))
        raise HTTPException(500, str(exc))


# ── GET /mandats ───────────────────────────────────────────────────────────────

@router.get("/mandats")
async def get_mandats(
    pcode: str = Query(..., description="Code pcode de l'entité administrative"),
) -> dict:
    """Liste les mandats historiques enregistrés pour une entité administrative."""
    try:
        pool = await get_pool()
        rows = await pool.fetch(
            """
            SELECT id, pcode, personne, fonction, date_debut, date_fin,
                   interimaire, source, url_source, confiance, statut,
                   cree_le
            FROM responsable_mandat
            WHERE pcode = $1
            ORDER BY COALESCE(date_debut, cree_le) DESC
            """,
            pcode,
        )

        mandats = []
        for row in rows:
            d = dict(row)
            for field in ('date_debut', 'date_fin'):
                if d.get(field) is not None:
                    d[field] = str(d[field])
            if d.get('cree_le') is not None:
                d['cree_le'] = d['cree_le'].isoformat()
            mandats.append(d)

        return {'total': len(mandats), 'mandats': mandats}

    except Exception as exc:
        logger.error("responsables_router.mandats_error", pcode=pcode, error=str(exc))
        raise HTTPException(500, str(exc))


# ── POST /reconstituer ────────────────────────────────────────────────────────

class ReconstituerIn(BaseModel):
    pcode: str
    nom_entite: str


@router.post("/reconstituer", status_code=202)
async def reconstituer(payload: ReconstituerIn) -> dict:
    """
    Lance la reconstitution historique des mandats pour une entité administrative.
    Démarre en arrière-plan et retourne immédiatement.
    """
    try:
        from .historique import reconstituteur_historique

        pool = await get_pool()

        asyncio.create_task(
            reconstituteur_historique.reconstituer_entite(
                payload.pcode, payload.nom_entite, pool
            )
        )

        return {'ok': True, 'message': 'Reconstitution lancée'}

    except Exception as exc:
        logger.error("responsables_router.reconstituer_error", pcode=payload.pcode, error=str(exc))
        raise HTTPException(500, str(exc))
