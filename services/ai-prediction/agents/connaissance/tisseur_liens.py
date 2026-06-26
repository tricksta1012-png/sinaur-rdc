"""
Tisseur de liens — établit et renforce les relations entre entités du graphe.

Une relation vue par plusieurs sources indépendantes voit sa confiance augmenter.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import structlog
from sqlalchemy import text

logger = structlog.get_logger(__name__)

TYPES_VALIDES = {
    "OPERE_DANS", "DIRIGE", "AFFRONTE", "FACTION_DE",
    "LIE_A", "IMPLIQUE_DANS", "ALLIE_DE", "RIVAL_DE", "SUCCEDE_A",
}


async def _resoudre_id(nom: str, nom_to_id: dict[str, int], conn) -> int | None:
    """Résout un nom d'entité vers son id en base (cherche d'abord dans le cache local)."""
    if nom in nom_to_id:
        return nom_to_id[nom]
    row = await conn.execute(
        text("""
            SELECT id FROM kb_entite
            WHERE actif = true
              AND (nom ILIKE :nom OR :nom = ANY(noms_alternatifs)
                   OR similarity(nom, :nom) > 0.55)
            ORDER BY similarity(nom, :nom) DESC
            LIMIT 1
        """),
        {"nom": nom},
    )
    found = row.fetchone()
    if found:
        nom_to_id[nom] = found[0]
        return found[0]
    return None


async def etablir_relation(
    source_nom: str,
    type_relation: str,
    cible_nom: str,
    detail: str,
    source_info: str,
    confiance: float,
    nom_to_id: dict[str, int],
    conn,
) -> None:
    if type_relation not in TYPES_VALIDES:
        return

    source_id = await _resoudre_id(source_nom, nom_to_id, conn)
    cible_id  = await _resoudre_id(cible_nom,  nom_to_id, conn)

    if not source_id or not cible_id or source_id == cible_id:
        return

    source_entry = json.dumps([{"nom": source_info, "date": datetime.now(timezone.utc).isoformat()}])

    existante = await conn.execute(
        text("""
            SELECT id, niveau_confiance, sources FROM kb_relation
            WHERE source_id = :sid AND cible_id = :cid AND type_relation = :type
        """),
        {"sid": source_id, "cid": cible_id, "type": type_relation},
    )
    row = existante.fetchone()

    if row:
        # Renforcer la relation existante
        sources_existantes = json.loads(row[2]) if row[2] else []
        noms_existants = {s.get("nom") for s in sources_existantes}
        if source_info not in noms_existants:
            sources_existantes.append({"nom": source_info, "date": datetime.now(timezone.utc).isoformat()})
        nouvelle_conf = min(0.95, float(row[1]) + 0.10)
        await conn.execute(
            text("""
                UPDATE kb_relation SET
                    niveau_confiance = :conf,
                    sources = CAST(:srcs AS jsonb)
                WHERE id = :rid
            """),
            {"conf": nouvelle_conf, "srcs": json.dumps(sources_existantes), "rid": row[0]},
        )
        logger.debug("tisseur.relation_renforcee",
                     source=source_nom, type=type_relation, cible=cible_nom,
                     conf=nouvelle_conf)
    else:
        # Nouvelle relation
        await conn.execute(
            text("""
                INSERT INTO kb_relation
                    (source_id, cible_id, type_relation, niveau_confiance, sources)
                VALUES (:sid, :cid, :type, :conf, CAST(:srcs AS jsonb))
                ON CONFLICT (source_id, cible_id, type_relation) DO NOTHING
            """),
            {
                "sid":  source_id,
                "cid":  cible_id,
                "type": type_relation,
                "conf": round(max(0.0, min(1.0, confiance)), 3),
                "srcs": source_entry,
            },
        )
        # Journal
        from agents.connaissance.decouvreur import journaliser
        await journaliser(
            source_id, "RELATION",
            f"{source_nom} --{type_relation}--> {cible_nom} ({detail})",
            source_info, "connaissance", None, confiance, conn,
        )
        logger.info("tisseur.nouvelle_relation",
                    source=source_nom, type=type_relation, cible=cible_nom)
