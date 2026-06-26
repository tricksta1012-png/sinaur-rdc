"""
Découverte d'entités inconnues dans les flux d'information SINAUR-RDC.

Analyse les textes (intel_events, articles presse, rapports) et identifie
les entités non encore présentes dans la base de connaissance.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import text

from db import engine

logger = structlog.get_logger(__name__)

SYSTEM_PROMPT = """Tu es analyste de renseignement pour SINAUR-RDC (République Démocratique du Congo).
Analyse ce texte et identifie toutes les ENTITÉS pertinentes pour la gestion de crise :
- GROUPE_ARME : milices, factions, groupes rebelles, forces armées
- PERSONNE : chefs de groupes, responsables, figures clés
- LIEU : zones de conflit, axes, localités, provinces
- EVENEMENT : attaques, redditions, accords, massacres
- EPIDEMIE : foyers épidémiques, maladies émergentes

Pour chaque entité extraite :
- type (parmi ceux listés)
- nom (forme canonique)
- alternatifs (autres noms utilisés dans le texte)
- description (factuelle, 1-2 phrases maximum)
- lieu (si applicable : province ou territoire RDC)
- confiance (0.0-1.0 : 1.0 = affirmatif et sourcé, 0.5 = conditionnel, 0.3 = rumeur)

Pour chaque RELATION évidente entre entités :
- source (nom de l'entité source)
- type_relation : OPERE_DANS | DIRIGE | AFFRONTE | FACTION_DE | LIE_A | IMPLIQUE_DANS | ALLIE_DE | RIVAL_DE
- cible (nom de l'entité cible)
- detail (ce qui justifie ce lien)
- confiance (0.0-1.0)

Réponds UNIQUEMENT en JSON valide :
{
  "entites": [
    {"type": "GROUPE_ARME", "nom": "Nom du groupe", "alternatifs": [], "description": "...", "lieu": "Province", "confiance": 0.9}
  ],
  "relations": [
    {"source": "Groupe A", "type_relation": "AFFRONTE", "cible": "Groupe B", "detail": "...", "confiance": 0.8}
  ]
}

Si aucune entité pertinente n'est trouvée, réponds : {"entites": [], "relations": []}"""


async def extraire_entites(texte: str) -> dict:
    """Appelle Claude pour extraire les entités d'un texte."""
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": texte[:4000]}],
        )
        raw = msg.content[0].text.strip()
        # Extraire le JSON même si entouré de backticks
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        return json.loads(m.group(0)) if m else {"entites": [], "relations": []}
    except Exception as exc:
        logger.warning("decouvreur.extraction_failed", error=str(exc))
        return {"entites": [], "relations": []}


async def chercher_entite(nom: str, type_entite: str, conn) -> Any | None:
    """Recherche tolérante : nom exact, alias, ou similarité pg_trgm > 0.6."""
    row = await conn.execute(
        text("""
            SELECT id, nom, noms_alternatifs, niveau_confiance, sources, attributs, statut_connaissance
            FROM kb_entite
            WHERE actif = true
              AND type_entite = :type
              AND (
                nom ILIKE :nom
                OR :nom = ANY(noms_alternatifs)
                OR similarity(nom, :nom) > 0.6
              )
            ORDER BY similarity(nom, :nom) DESC
            LIMIT 1
        """),
        {"type": type_entite, "nom": nom},
    )
    return row.fetchone()


async def creer_entite(ent: dict, source: str, conn) -> int:
    """Insère une nouvelle entité dans kb_entite. Retourne son id."""
    sources_json = json.dumps([{"nom": source, "date": datetime.now(timezone.utc).isoformat()}])
    result = await conn.execute(
        text("""
            INSERT INTO kb_entite
                (type_entite, nom, noms_alternatifs, description,
                 niveau_confiance, statut_connaissance, nb_mentions,
                 sources, attributs)
            VALUES
                (:type, :nom, :alternatifs, :description,
                 :confiance, 'EMERGENT', 1,
                 CAST(:sources AS jsonb), CAST(:attributs AS jsonb))
            RETURNING id
        """),
        {
            "type":        ent["type"],
            "nom":         ent["nom"],
            "alternatifs": ent.get("alternatifs") or [],
            "description": ent.get("description", ""),
            "confiance":   min(1.0, max(0.0, float(ent.get("confiance", 0.5)))),
            "sources":     sources_json,
            "attributs":   json.dumps({"lieu": ent.get("lieu")} if ent.get("lieu") else {}),
        },
    )
    row = result.fetchone()
    return row[0]


async def journaliser(entite_id: int | None, type_action: str, detail: str,
                      source: str, agent: str, conf_avant: float | None,
                      conf_apres: float | None, conn) -> None:
    await conn.execute(
        text("""
            INSERT INTO kb_apprentissage
                (entite_id, type_action, detail, source, agent,
                 confiance_avant, confiance_apres)
            VALUES (:eid, :action, :detail, :src, :agent, :cav, :cap)
        """),
        {
            "eid":    entite_id,
            "action": type_action,
            "detail": detail,
            "src":    source,
            "agent":  agent,
            "cav":    conf_avant,
            "cap":    conf_apres,
        },
    )


async def analyser_texte(texte: str, source: str) -> dict[str, int]:
    """
    Point d'entrée principal. Analyse un texte, crée ou enrichit les entités trouvées.
    Retourne un résumé {decouvertes, enrichissements}.
    """
    if not texte or len(texte.strip()) < 30:
        return {"decouvertes": 0, "enrichissements": 0}

    extraction = await extraire_entites(texte)
    entites = extraction.get("entites", [])
    relations = extraction.get("relations", [])

    decouvertes = 0
    enrichissements = 0
    nom_to_id: dict[str, int] = {}

    async with engine.begin() as conn:
        # Phase 1 : entités
        for ent in entites:
            if not ent.get("nom") or not ent.get("type"):
                continue
            existante = await chercher_entite(ent["nom"], ent["type"], conn)

            if existante:
                from agents.connaissance.enrichisseur import enrichir_entite
                await enrichir_entite(existante, ent, source, conn)
                nom_to_id[ent["nom"]] = existante[0]
                enrichissements += 1
            else:
                eid = await creer_entite(ent, source, conn)
                nom_to_id[ent["nom"]] = eid
                await journaliser(
                    eid, "DECOUVERTE",
                    f"Nouvelle entité {ent['type']} : {ent.get('description', '')}",
                    source, "connaissance", None, ent.get("confiance", 0.5), conn,
                )
                decouvertes += 1
                logger.info("decouvreur.nouvelle_entite",
                            nom=ent["nom"], type=ent["type"], source=source)

        # Phase 2 : relations
        if relations:
            from agents.connaissance.tisseur_liens import etablir_relation
            for rel in relations:
                src_nom = rel.get("source", "")
                cible_nom = rel.get("cible", "")
                if src_nom and cible_nom:
                    await etablir_relation(
                        src_nom, rel.get("type_relation", "LIE_A"),
                        cible_nom, rel.get("detail", ""),
                        source, float(rel.get("confiance", 0.5)),
                        nom_to_id, conn,
                    )

    return {"decouvertes": decouvertes, "enrichissements": enrichissements}
