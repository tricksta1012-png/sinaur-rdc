"""
Enrichissement des entités connues : ajout d'attributs nouveaux et corroboration.

Chaque nouvelle mention d'une entité connue :
  1. Fusionne les attributs sans écraser les anciens
  2. Augmente la confiance (corroboration par sources indépendantes)
  3. Fait évoluer le statut EMERGENT → A_CONFIRMER → ETABLI
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import text

logger = structlog.get_logger(__name__)


def _statut(nb_sources: int) -> str:
    if nb_sources >= 3:
        return "ETABLI"
    if nb_sources == 2:
        return "A_CONFIRMER"
    return "EMERGENT"


def _nouvelle_confiance(nb_sources: int, confiance_extraite: float) -> float:
    """Confiance = max(extraite, basée sur le nb de sources indépendantes)."""
    base = min(0.95, 0.40 + 0.15 * nb_sources)
    return round(max(base, confiance_extraite), 3)


async def enrichir_entite(existante: Any, nouvelle_info: dict, source: str, conn) -> None:
    """
    Met à jour une entité existante avec de nouvelles informations.
    existante : Row sqlalchemy (id, nom, noms_alternatifs, niveau_confiance, sources, attributs, statut_connaissance)
    """
    from agents.connaissance.decouvreur import journaliser

    eid = existante[0]
    confiance_avant = float(existante[3])

    # Sources existantes
    sources: list[dict] = json.loads(existante[4]) if existante[4] else []
    source_noms = {s.get("nom") for s in sources}

    if source not in source_noms:
        sources.append({"nom": source, "date": datetime.now(timezone.utc).isoformat()})

    nb_sources = len(sources)
    confiance_extraite = float(nouvelle_info.get("confiance", confiance_avant))
    nouvelle_conf = _nouvelle_confiance(nb_sources, confiance_extraite)
    nouveau_statut = _statut(nb_sources)

    # Fusion des attributs (ne pas écraser)
    attributs: dict = json.loads(existante[5]) if existante[5] else {}
    attributs_nouveaux = nouvelle_info.get("attributs") or {}
    if nouvelle_info.get("lieu") and "lieu" not in attributs:
        attributs_nouveaux["lieu"] = nouvelle_info["lieu"]
    nouveaux_ajouts = []
    for cle, val in attributs_nouveaux.items():
        if cle not in attributs:
            attributs[cle] = val
            nouveaux_ajouts.append(cle)

    # Alias nouveaux
    alternatifs: list[str] = list(existante[2] or [])
    for alt in (nouvelle_info.get("alternatifs") or []):
        if alt and alt not in alternatifs:
            alternatifs.append(alt)

    # Mise à jour
    await conn.execute(
        text("""
            UPDATE kb_entite SET
                noms_alternatifs    = :alts,
                attributs           = CAST(:attrs AS jsonb),
                sources             = CAST(:srcs AS jsonb),
                niveau_confiance    = :conf,
                statut_connaissance = :statut,
                nb_mentions         = nb_mentions + 1,
                derniere_mention    = NOW(),
                maj_le              = NOW()
            WHERE id = :eid
        """),
        {
            "alts":   alternatifs,
            "attrs":  json.dumps(attributs),
            "srcs":   json.dumps(sources),
            "conf":   nouvelle_conf,
            "statut": nouveau_statut,
            "eid":    eid,
        },
    )

    # Journal si la confiance a monté ou si nouveaux attributs
    if nouvelle_conf > confiance_avant or nouveaux_ajouts:
        detail_parts = []
        if nouvelle_conf > confiance_avant:
            detail_parts.append(
                f"Confiance {confiance_avant:.2f}→{nouvelle_conf:.2f} ({nb_sources} sources)"
            )
        if nouveaux_ajouts:
            detail_parts.append(f"Nouveaux attributs : {', '.join(nouveaux_ajouts)}")

        action = "CONFIRMATION" if nouvelle_conf > confiance_avant else "ENRICHISSEMENT"
        await journaliser(
            eid, action, " | ".join(detail_parts),
            source, "connaissance", confiance_avant, nouvelle_conf, conn,
        )
        logger.debug("enrichisseur.enrichi", eid=eid, conf=nouvelle_conf, statut=nouveau_statut)
