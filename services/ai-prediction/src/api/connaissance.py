"""
Router /internal/connaissance — Moteur de Connaissance Évolutif SINAUR-RDC.
Lit les tables kb_entite / kb_relation / kb_apprentissage créées par migration 033.
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException
from .auth import require_internal_key
from ..database import fetch_all, engine
from sqlalchemy import text

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/internal/connaissance",
    tags=["internal-connaissance"],
    dependencies=[Depends(require_internal_key)],
)


def _tables_exist() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1 FROM kb_entite LIMIT 1"))
        return True
    except Exception:
        return False


# ── Status ───────────────────────────────────────────────────────────────────

@router.get("/status")
def get_status():
    if not _tables_exist():
        return {"total_decouvertes": 0, "total_enrichissements": 0, "runs_total": 0,
                "nb_entites": 0, "nb_relations": 0, "ready": False}
    try:
        rows = fetch_all("""
            SELECT
                COUNT(*) FILTER (WHERE type_action = 'DECOUVERTE')    AS total_decouvertes,
                COUNT(*) FILTER (WHERE type_action = 'ENRICHISSEMENT') AS total_enrichissements,
                COUNT(*) FILTER (WHERE type_action = 'RELATION')       AS total_relations,
                COUNT(*)                                               AS runs_total
            FROM kb_apprentissage
        """, {})
        stats = rows[0] if rows else {}

        entites = fetch_all("SELECT COUNT(*) AS n FROM kb_entite WHERE actif = TRUE", {})
        relations = fetch_all("SELECT COUNT(*) AS n FROM kb_relation WHERE actif = TRUE", {})

        return {
            "total_decouvertes":    int(stats.get("total_decouvertes", 0) or 0),
            "total_enrichissements": int(stats.get("total_enrichissements", 0) or 0),
            "runs_total":            int(stats.get("runs_total", 0) or 0),
            "nb_entites":            int(entites[0]["n"] if entites else 0),
            "nb_relations":          int(relations[0]["n"] if relations else 0),
            "ready": True,
        }
    except Exception as e:
        logger.error(f"connaissance/status: {e}")
        return {"total_decouvertes": 0, "total_enrichissements": 0, "runs_total": 0,
                "nb_entites": 0, "nb_relations": 0, "ready": False}


# ── Entités ──────────────────────────────────────────────────────────────────

@router.get("/entites")
def list_entites(
    type_entite: str | None = None,
    statut: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    if not _tables_exist():
        return {"data": [], "total": 0}
    try:
        conditions = ["actif = TRUE"]
        params: dict = {"limit": min(limit, 200), "offset": offset}

        if type_entite:
            conditions.append("type_entite = :type_entite")
            params["type_entite"] = type_entite
        if statut:
            conditions.append("statut_connaissance = :statut")
            params["statut"] = statut
        if q:
            conditions.append("(nom ILIKE :q OR description ILIKE :q)")
            params["q"] = f"%{q}%"

        where = " AND ".join(conditions)
        rows = fetch_all(f"""
            SELECT id, type_entite, nom, noms_alternatifs, description,
                   niveau_confiance, statut_connaissance, nb_mentions,
                   derniere_mention, attributs
            FROM kb_entite
            WHERE {where}
            ORDER BY nb_mentions DESC, derniere_mention DESC
            LIMIT :limit OFFSET :offset
        """, params)

        count_rows = fetch_all(f"SELECT COUNT(*) AS n FROM kb_entite WHERE {where}",
                               {k: v for k, v in params.items() if k not in ("limit", "offset")})
        total = int(count_rows[0]["n"]) if count_rows else len(rows)

        # Serialize
        for r in rows:
            if r.get("niveau_confiance") is not None:
                r["niveau_confiance"] = float(r["niveau_confiance"])
            if r.get("derniere_mention") is not None:
                r["derniere_mention"] = str(r["derniere_mention"])
            if r.get("noms_alternatifs") is None:
                r["noms_alternatifs"] = []
            if r.get("attributs") is None:
                r["attributs"] = {}

        return {"data": rows, "total": total}
    except Exception as e:
        logger.error(f"connaissance/entites: {e}")
        return {"data": [], "total": 0}


@router.get("/entites/{entite_id}")
def get_entite(entite_id: int):
    if not _tables_exist():
        raise HTTPException(404, "Tables not initialized")
    try:
        rows = fetch_all("""
            SELECT id, type_entite, nom, noms_alternatifs, description,
                   niveau_confiance, statut_connaissance, nb_mentions,
                   premiere_mention, derniere_mention, attributs, pcode
            FROM kb_entite WHERE id = :id AND actif = TRUE
        """, {"id": entite_id})

        if not rows:
            raise HTTPException(404, "Entité introuvable")
        ent = rows[0]
        ent["niveau_confiance"] = float(ent.get("niveau_confiance") or 0.5)
        ent["noms_alternatifs"] = ent.get("noms_alternatifs") or []
        ent["attributs"] = ent.get("attributs") or {}
        for k in ("premiere_mention", "derniere_mention"):
            if ent.get(k):
                ent[k] = str(ent[k])

        relations = fetch_all("""
            SELECT r.id, r.type_relation, r.niveau_confiance, r.depuis,
                   c.id AS cible_id, c.nom AS cible_nom, c.type_entite AS cible_type
            FROM kb_relation r
            JOIN kb_entite c ON c.id = r.cible_id
            WHERE r.source_id = :id AND r.actif = TRUE
            ORDER BY r.niveau_confiance DESC
        """, {"id": entite_id})
        for r in relations:
            r["niveau_confiance"] = float(r.get("niveau_confiance") or 0.5)
            if r.get("depuis"):
                r["depuis"] = str(r["depuis"])

        journal = fetch_all("""
            SELECT a.id, a.type_action, a.detail, a.source,
                   a.confiance_avant, a.confiance_apres, a.date_appris,
                   e.nom AS entite_nom
            FROM kb_apprentissage a
            LEFT JOIN kb_entite e ON e.id = a.entite_id
            WHERE a.entite_id = :id
            ORDER BY a.date_appris DESC
            LIMIT 30
        """, {"id": entite_id})
        for j in journal:
            for k in ("confiance_avant", "confiance_apres"):
                if j.get(k) is not None:
                    j[k] = float(j[k])
            if j.get("date_appris"):
                j["date_appris"] = str(j["date_appris"])

        return {"entite": ent, "relations": relations, "journal": journal}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"connaissance/entites/{entite_id}: {e}")
        raise HTTPException(500, str(e))


# ── Graphe ───────────────────────────────────────────────────────────────────

@router.get("/graphe")
def get_graphe(min_confiance: float = 0.5):
    if not _tables_exist():
        return {"nodes": [], "links": []}
    try:
        nodes = fetch_all("""
            SELECT id, type_entite, nom, niveau_confiance, statut_connaissance, nb_mentions
            FROM kb_entite
            WHERE actif = TRUE AND niveau_confiance >= :min_conf
            ORDER BY nb_mentions DESC
            LIMIT 200
        """, {"min_conf": min_confiance})
        for n in nodes:
            n["niveau_confiance"] = float(n.get("niveau_confiance") or 0.5)

        node_ids = {n["id"] for n in nodes}
        if not node_ids:
            return {"nodes": [], "links": []}

        links = fetch_all("""
            SELECT source_id, cible_id, type_relation, niveau_confiance
            FROM kb_relation
            WHERE actif = TRUE
              AND niveau_confiance >= :min_conf
            ORDER BY niveau_confiance DESC
            LIMIT 500
        """, {"min_conf": min_confiance})

        links = [l for l in links if l["source_id"] in node_ids and l["cible_id"] in node_ids]
        for l in links:
            l["niveau_confiance"] = float(l.get("niveau_confiance") or 0.5)

        return {"nodes": nodes, "links": links}
    except Exception as e:
        logger.error(f"connaissance/graphe: {e}")
        return {"nodes": [], "links": []}


# ── Journal d'apprentissage ──────────────────────────────────────────────────

@router.get("/apprentissage")
def get_apprentissage(limit: int = 50):
    if not _tables_exist():
        return {"data": []}
    try:
        rows = fetch_all("""
            SELECT a.id, a.type_action, a.detail, a.source, a.agent,
                   a.confiance_avant, a.confiance_apres, a.date_appris,
                   e.nom AS entite_nom
            FROM kb_apprentissage a
            LEFT JOIN kb_entite e ON e.id = a.entite_id
            ORDER BY a.date_appris DESC
            LIMIT :limit
        """, {"limit": min(limit, 200)})
        for r in rows:
            for k in ("confiance_avant", "confiance_apres"):
                if r.get(k) is not None:
                    r[k] = float(r[k])
            if r.get("date_appris"):
                r["date_appris"] = str(r["date_appris"])
        return {"data": rows}
    except Exception as e:
        logger.error(f"connaissance/apprentissage: {e}")
        return {"data": []}


# ── Analyser (extraction IA) ─────────────────────────────────────────────────

@router.post("/analyser")
def analyser(body: dict):
    texte = body.get("texte", "")
    source = body.get("source", "manuel")
    if len(texte) < 10:
        raise HTTPException(400, "Texte trop court")

    # Extraction basique par mots-clés RDC (placeholder — à remplacer par LLM)
    found: list[dict] = []
    mots = texte.lower().split()
    groupes_connus = ["m23", "adf", "fdlr", "maï-maï", "wazalendo", "forces vives"]
    for g in groupes_connus:
        if g in texte.lower():
            found.append({"type": "GROUPE_ARME", "nom": g.upper(), "confiance": 0.7})

    if not _tables_exist():
        return {"extracted": found, "persisted": 0, "source": source}

    persisted = 0
    try:
        with engine.begin() as conn:
            for ent in found:
                existing = fetch_all(
                    "SELECT id FROM kb_entite WHERE nom ILIKE :nom AND type_entite = :type",
                    {"nom": ent["nom"], "type": ent["type"]}
                )
                if existing:
                    conn.execute(text(
                        "UPDATE kb_entite SET nb_mentions = nb_mentions + 1, derniere_mention = NOW() WHERE id = :id"
                    ), {"id": existing[0]["id"]})
                    conn.execute(text("""
                        INSERT INTO kb_apprentissage (entite_id, type_action, detail, source, confiance_avant, confiance_apres)
                        VALUES (:eid, 'ENRICHISSEMENT', :detail, :src, :ca, :ca)
                    """), {"eid": existing[0]["id"], "detail": f"Nouvelle mention dans texte ({source})",
                           "src": source, "ca": ent["confiance"]})
                else:
                    res = conn.execute(text("""
                        INSERT INTO kb_entite (type_entite, nom, niveau_confiance, statut_connaissance, sources)
                        VALUES (:type, :nom, :conf, 'EMERGENT', :src::jsonb)
                        RETURNING id
                    """), {"type": ent["type"], "nom": ent["nom"], "conf": ent["confiance"],
                           "src": f'["{source}"]'})
                    new_id = res.fetchone()[0]
                    conn.execute(text("""
                        INSERT INTO kb_apprentissage (entite_id, type_action, detail, source, confiance_apres)
                        VALUES (:eid, 'DECOUVERTE', :detail, :src, :conf)
                    """), {"eid": new_id, "detail": f"Entité découverte via analyse de texte",
                           "src": source, "conf": ent["confiance"]})
                persisted += 1
    except Exception as e:
        logger.error(f"connaissance/analyser persist: {e}")

    return {"extracted": found, "persisted": persisted, "source": source}
