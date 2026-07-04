"""
Agent d'ingestion automatique — lit les disaster_events récents et enrichit la base de connaissance.
Tourne en arrière-plan toutes les INTERVAL_SECONDS secondes.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from ..database import engine, fetch_all

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 900  # 15 min

# Entités connues à détecter dans les textes d'événements
# Format : (nom_canonique, [variantes_à_chercher])
_ENTITES: dict[str, list[tuple[str, list[str]]]] = {
    "GROUPE_ARME": [
        ("M23",        ["M23", "Mouvement du 23 mars"]),
        ("ADF",        ["ADF", "Forces démocratiques alliées", "Allied Democratic Forces"]),
        ("FDLR",       ["FDLR", "Forces démocratiques de libération du Rwanda"]),
        ("MAÏ-MAÏ",   ["Maï-Maï", "Mai-Mai", "Mayi-Mayi"]),
        ("WAZALENDO",  ["Wazalendo"]),
        ("AFC/M23",    ["AFC/M23", "Alliance Fleuve Congo"]),
        ("CODECO",     ["CODECO"]),
        ("FNLC",       ["FNLC"]),
        ("RED-TABARA", ["RED-Tabara", "RED Tabara"]),
    ],
    "EPIDEMIE": [
        ("EBOLA",    ["Ebola", "MVE", "maladie à virus Ebola"]),
        ("MPOX",     ["Mpox", "variole du singe", "monkeypox"]),
        ("CHOLERA",  ["choléra", "cholera"]),
        ("ROUGEOLE", ["rougeole", "measles"]),
        ("COVID-19", ["COVID", "Covid-19", "coronavirus"]),
        ("PALUDISME",["paludisme", "malaria"]),
    ],
    "LIEU": [
        ("GOMA",       ["Goma"]),
        ("BENI",       ["Beni"]),
        ("BUTEMBO",    ["Butembo"]),
        ("BUKAVU",     ["Bukavu"]),
        ("KINSHASA",   ["Kinshasa"]),
        ("RUTSHURU",   ["Rutshuru"]),
        ("MASISI",     ["Masisi"]),
        ("LUBUMBASHI", ["Lubumbashi"]),
        ("UVIRA",      ["Uvira"]),
        ("MINEMBWE",   ["Minembwe"]),
        ("KALEHE",     ["Kalehe"]),
        ("FIZI",       ["Fizi"]),
        ("MWESO",      ["Mweso"]),
        ("KASINDI",    ["Kasindi"]),
    ],
}


def _extract(texte: str) -> list[dict]:
    found: list[dict] = []
    seen: set[str] = set()
    low = texte.lower()
    for type_entite, entites in _ENTITES.items():
        for nom, variantes in entites:
            if nom in seen:
                continue
            for v in variantes:
                if v.lower() in low:
                    found.append({"type": type_entite, "nom": nom, "variante": v, "confiance": 0.75})
                    seen.add(nom)
                    break
    return found


def _run_once(since: datetime) -> tuple[int, int]:
    """Ingère les événements créés depuis `since`. Retourne (nb_decouvertes, nb_enrichissements)."""
    try:
        events = fetch_all(
            """
            SELECT id, title, description, created_at
            FROM disaster_events
            WHERE created_at >= :since
              AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 200
            """,
            {"since": since.isoformat()},
        )
        if not events:
            return 0, 0

        decouvertes = enrichissements = 0
        with engine.begin() as conn:
            for ev in events:
                texte = f"{ev.get('title', '')} {ev.get('description', '')}".strip()
                if len(texte) < 5:
                    continue
                source = f"event:{ev['id']}"

                for ent in _extract(texte):
                    existing = fetch_all(
                        "SELECT id, niveau_confiance FROM kb_entite WHERE nom = :nom AND type_entite = :type AND actif = TRUE",
                        {"nom": ent["nom"], "type": ent["type"]},
                    )
                    if existing:
                        eid = existing[0]["id"]
                        old_conf = float(existing[0]["niveau_confiance"] or 0.5)
                        new_conf = min(0.99, old_conf + 0.01)
                        conn.execute(text("""
                            UPDATE kb_entite
                            SET nb_mentions = nb_mentions + 1,
                                derniere_mention = NOW(),
                                niveau_confiance = :conf
                            WHERE id = :id
                        """), {"id": eid, "conf": new_conf})
                        conn.execute(text("""
                            INSERT INTO kb_apprentissage
                              (entite_id, type_action, detail, source, agent, confiance_avant, confiance_apres)
                            VALUES (:eid, 'ENRICHISSEMENT', :detail, :src, 'ingestion-agent', :ca, :cb)
                        """), {
                            "eid": eid,
                            "detail": f"Mention «{ent['variante']}» dans événement #{ev['id']}",
                            "src": source, "ca": old_conf, "cb": new_conf,
                        })
                        enrichissements += 1
                    else:
                        res = conn.execute(text("""
                            INSERT INTO kb_entite
                              (type_entite, nom, niveau_confiance, statut_connaissance, sources, nb_mentions)
                            VALUES (:type, :nom, :conf, 'EMERGENT', :src::jsonb, 1)
                            RETURNING id
                        """), {
                            "type": ent["type"], "nom": ent["nom"],
                            "conf": ent["confiance"],
                            "src": f'["{source}"]',
                        })
                        new_id = res.fetchone()[0]
                        conn.execute(text("""
                            INSERT INTO kb_apprentissage
                              (entite_id, type_action, detail, source, agent, confiance_apres)
                            VALUES (:eid, 'DECOUVERTE', :detail, :src, 'ingestion-agent', :conf)
                        """), {
                            "eid": new_id,
                            "detail": f"Entité «{ent['variante']}» découverte dans événement #{ev['id']}",
                            "src": source, "conf": ent["confiance"],
                        })
                        decouvertes += 1

        return decouvertes, enrichissements
    except Exception as e:
        logger.error(f"ingestion._run_once: {e}")
        return 0, 0


async def run_ingestion_loop() -> None:
    """Boucle async à lancer comme tâche de fond au démarrage FastAPI."""
    logger.info("Ingestion agent started (interval=%ds)", INTERVAL_SECONDS)
    # Première passe sur les 2 dernières heures pour rattraper les événements récents
    since = datetime.now(timezone.utc) - timedelta(hours=2)

    while True:
        await asyncio.sleep(INTERVAL_SECONDS)
        now = datetime.now(timezone.utc)
        try:
            dec, enr = _run_once(since)
            since = now
            if dec or enr:
                logger.info("Ingestion: +%d découvertes +%d enrichissements", dec, enr)
            else:
                logger.debug("Ingestion: aucun nouvel enrichissement")
        except Exception as e:
            logger.error("Ingestion loop error: %s", e)
