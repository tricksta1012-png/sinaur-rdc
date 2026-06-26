"""
Router ConnaissanceAgent — endpoints internes pour explorer le graphe de connaissance.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from db import engine
from sqlalchemy import text
import json

router = APIRouter(prefix="/internal/connaissance", tags=["connaissance"])


@router.get("/status")
async def get_status():
    from agents.connaissance.agent import connaissance_agent
    return connaissance_agent.get_status()


@router.get("/entites")
async def list_entites(
    type_entite: str | None = Query(None),
    statut: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    conditions = ["actif = true"]
    params: dict = {"limit": limit, "offset": offset}

    if type_entite:
        conditions.append("type_entite = :type")
        params["type"] = type_entite
    if statut:
        conditions.append("statut_connaissance = :statut")
        params["statut"] = statut
    if q:
        conditions.append("(nom ILIKE :q OR :q = ANY(noms_alternatifs))")
        params["q"] = f"%{q}%"

    where = " AND ".join(conditions)
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(f"""
                SELECT id, type_entite, nom, noms_alternatifs, description,
                       niveau_confiance, statut_connaissance, nb_mentions,
                       sources, attributs, premiere_mention, derniere_mention
                FROM kb_entite
                WHERE {where}
                ORDER BY derniere_mention DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        entites = [dict(r._mapping) for r in rows.fetchall()]

        total_row = await conn.execute(
            text(f"SELECT COUNT(*) FROM kb_entite WHERE {where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )
        total = total_row.scalar()

    return {"data": entites, "total": total, "limit": limit, "offset": offset}


@router.get("/entites/{entite_id}")
async def get_entite(entite_id: int):
    async with engine.connect() as conn:
        row = await conn.execute(
            text("SELECT * FROM kb_entite WHERE id = :id AND actif = true"),
            {"id": entite_id},
        )
        ent = row.fetchone()
        if not ent:
            raise HTTPException(status_code=404, detail="Entité introuvable")

        # Relations
        rels = await conn.execute(
            text("""
                SELECT r.id, r.type_relation, r.niveau_confiance, r.depuis, r.jusqua,
                       e.id as cible_id, e.nom as cible_nom, e.type_entite as cible_type
                FROM kb_relation r
                JOIN kb_entite e ON e.id = r.cible_id
                WHERE r.source_id = :id AND r.actif = true
                UNION ALL
                SELECT r.id, r.type_relation, r.niveau_confiance, r.depuis, r.jusqua,
                       e.id as cible_id, e.nom as cible_nom, e.type_entite as cible_type
                FROM kb_relation r
                JOIN kb_entite e ON e.id = r.source_id
                WHERE r.cible_id = :id AND r.actif = true
                ORDER BY niveau_confiance DESC
            """),
            {"id": entite_id},
        )

        # Journal
        journal = await conn.execute(
            text("""
                SELECT id, type_action, detail, source, agent,
                       confiance_avant, confiance_apres, date_appris
                FROM kb_apprentissage
                WHERE entite_id = :id
                ORDER BY date_appris DESC
                LIMIT 20
            """),
            {"id": entite_id},
        )

    return {
        "entite":    dict(ent._mapping),
        "relations": [dict(r._mapping) for r in rels.fetchall()],
        "journal":   [dict(j._mapping) for j in journal.fetchall()],
    }


@router.get("/graphe")
async def get_graphe(min_confiance: float = Query(0.5)):
    """Retourne nœuds + liens pour visualisation."""
    async with engine.connect() as conn:
        noeuds = await conn.execute(
            text("""
                SELECT id, type_entite, nom, niveau_confiance, statut_connaissance, nb_mentions
                FROM kb_entite
                WHERE actif = true AND niveau_confiance >= :conf
                ORDER BY nb_mentions DESC
                LIMIT 200
            """),
            {"conf": min_confiance},
        )
        liens = await conn.execute(
            text("""
                SELECT r.source_id, r.cible_id, r.type_relation, r.niveau_confiance
                FROM kb_relation r
                JOIN kb_entite s ON s.id = r.source_id AND s.actif = true
                JOIN kb_entite c ON c.id = r.cible_id AND c.actif = true
                WHERE r.actif = true AND r.niveau_confiance >= :conf
            """),
            {"conf": min_confiance},
        )

    return {
        "nodes": [dict(n._mapping) for n in noeuds.fetchall()],
        "links": [dict(l._mapping) for l in liens.fetchall()],
    }


@router.get("/apprentissage")
async def get_apprentissage(limit: int = Query(50, le=200)):
    async with engine.connect() as conn:
        rows = await conn.execute(
            text("""
                SELECT a.id, a.type_action, a.detail, a.source, a.agent,
                       a.confiance_avant, a.confiance_apres, a.date_appris,
                       e.nom as entite_nom, e.type_entite
                FROM kb_apprentissage a
                LEFT JOIN kb_entite e ON e.id = a.entite_id
                ORDER BY a.date_appris DESC
                LIMIT :limit
            """),
            {"limit": limit},
        )
    return {"data": [dict(r._mapping) for r in rows.fetchall()]}


@router.post("/analyser")
async def analyser_texte_manuel(body: dict):
    """Analyse manuelle d'un texte pour tester l'extraction."""
    texte = body.get("texte", "")
    source = body.get("source", "manuel")
    if not texte:
        raise HTTPException(status_code=400, detail="texte requis")

    from agents.connaissance.decouvreur import analyser_texte
    result = await analyser_texte(texte, source)
    return {"success": True, **result}
