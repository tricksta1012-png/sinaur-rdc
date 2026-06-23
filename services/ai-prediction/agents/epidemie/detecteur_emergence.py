"""
DetecteurEmergence — veille des pathogènes inconnus / signaux faibles.

Logique distincte du suivi des maladies connues :
  - SUIVI : extraire les chiffres d'une maladie CONNUE (→ epidemic_zone/timeseries)
  - DÉTECTION : repérer un pathogène INCONNU → prudence, corroboration requise

Niveaux de statut (progressifs) :
  SIGNAL_ISOLE        : 1 source  → veille discrète
  A_SURVEILLER        : 2 sources → attention
  EMERGENCE_CORROBOREE: 3+ sources → alerte (nécessite validation humaine)

Sources spécialisées dans la détection précoce mondiale :
  WHO DON, ProMED, HealthMap, ECDC, CDC HAN, Africa CDC

Table cible : emergence_veille (séparée des épidémies confirmées)
"""
from __future__ import annotations

import json
import re
import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog
from sqlalchemy import text

from agents.epidemie.referentiel import NOMS_CONNUS
from agents import bus
from db import engine

logger = structlog.get_logger(__name__)

# ── Sources spécialisées détection précoce ─────────────────────────────────────

SOURCES_EMERGENCE: dict[str, dict] = {
    'who_don':    {'url': 'https://www.who.int/rss-feeds/news-en.xml',   'fiabilite': 0.97, 'type': 'rss'},
    'promed':     {'url': 'https://promedmail.org/feed/',                 'fiabilite': 0.88, 'type': 'rss'},
    'ecdc':       {'url': 'https://www.ecdc.europa.eu/en/rss.xml',        'fiabilite': 0.92, 'type': 'rss'},
    'africa_cdc': {'url': 'https://africacdc.org/feed/',                  'fiabilite': 0.90, 'type': 'rss'},
    'cdc_han':    {'url': 'https://emergency.cdc.gov/han/feed.asp',       'fiabilite': 0.95, 'type': 'rss'},
    'healthmap':  {'url': 'https://healthmap.org/rss/allAlerts.rss',      'fiabilite': 0.82, 'type': 'rss'},
}

HEADERS = {
    "User-Agent": "SINAUR-RDC/2.0 (plateforme humanitaire RDC; contact@sinaur-rdc.cd)",
}

SYSTEM_PROMPT_EMERGENCE = """Tu es veilleur en maladies émergentes pour SINAUR-RDC (RDC).
On te donne un texte de surveillance sanitaire mondiale.

Identifie tout PATHOGÈNE ou SYNDROME inhabituel mentionné : nouveau virus, maladie rare,
cluster de cas inexpliqués, syndrome non identifié.

Ne signale PAS les maladies courantes suivantes (déjà suivies par SINAUR) :
ebola, choléra, mpox, rougeole, méningite, paludisme, fièvre jaune, malaria,
measles, cholera, monkeypox.

Pour chaque signal INHABITUEL, indique :
- le nom du pathogène/syndrome
- la localisation géographique
- s'il y a transmission interhumaine (true/false/null si inconnu)
- le niveau de préoccupation exprimé dans le texte (faible/modéré/élevé)
- la pertinence pour la RDC (faible/modérée/élevée)
- la raison de pertinence pour la RDC (proximité, flux de population, etc.)

Réponds UNIQUEMENT en JSON valide :
{
  "signaux": [
    {
      "pathogene": "nom du pathogène",
      "localisation": "pays ou région",
      "transmission_interhumaine": true,
      "preoccupation": "élevée",
      "pertinence_rdc": "modérée",
      "raison": "raison courte"
    }
  ]
}
Si aucun signal inhabituel : {"signaux": []}"""


# ── In-memory store ────────────────────────────────────────────────────────────

_EMERGENCE_STORE: list[dict] = []

_STATUS: dict[str, Any] = {
    "last_run": None,
    "runs_total": 0,
    "signaux_detectes": 0,
    "erreurs": [],
}


# ── LLM helper ────────────────────────────────────────────────────────────────

def _get_llm_client() -> Any:
    try:
        import anthropic
        from config import settings
        api_key = getattr(settings, 'anthropic_api_key', '')
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY non configurée")
        return anthropic.Anthropic(api_key=api_key)
    except ImportError:
        raise RuntimeError("Package 'anthropic' manquant")


async def _analyser_texte(texte: str) -> list[dict]:
    """Appel LLM pour détecter les signaux inhabituels dans un texte."""
    try:
        client = _get_llm_client()
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",  # Haiku — rapide et moins cher pour la veille
            max_tokens=1500,
            system=SYSTEM_PROMPT_EMERGENCE,
            messages=[{"role": "user", "content": texte[:6000]}],
        )
        raw = message.content[0].text
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if m:
            parsed = json.loads(m.group())
            return parsed.get('signaux', [])
    except Exception as exc:
        logger.warning("detecteur_emergence.llm_error", error=str(exc))
    return []


# ── RSS fetcher ────────────────────────────────────────────────────────────────

async def _fetch_rss(url: str) -> str:
    """Récupère le contenu d'un flux RSS, retourne le texte brut."""
    try:
        async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.text
    except Exception as exc:
        logger.warning("detecteur_emergence.fetch_error", url=url, error=str(exc))
        return ""


# ── Persistence ────────────────────────────────────────────────────────────────

async def _est_connu_en_db(pathogene: str) -> int:
    """Compte les mentions existantes du même pathogène en DB (corroboration)."""
    async with engine.connect() as conn:
        row = (await conn.execute(
            text("SELECT sources_count FROM emergence_veille WHERE pathogene ILIKE :p AND traite = false LIMIT 1"),
            {"p": f"%{pathogene}%"},
        )).fetchone()
        return row[0] if row else 0


async def _upsert_emergence(signal: dict, source_id: str) -> str:
    """Insère ou met à jour un signal dans emergence_veille. Retourne le statut."""
    pathogene = signal['pathogene']
    sources_existantes = await _est_connu_en_db(pathogene)
    sources_count = sources_existantes + 1

    if sources_count >= 3:
        statut = 'EMERGENCE_CORROBOREE'
    elif sources_count == 2:
        statut = 'A_SURVEILLER'
    else:
        statut = 'SIGNAL_ISOLE'

    detail = {
        "localisation": signal.get("localisation"),
        "preoccupation": signal.get("preoccupation"),
        "raison": signal.get("raison"),
        "source": source_id,
    }

    async with engine.begin() as conn:
        existing = (await conn.execute(
            text("SELECT id FROM emergence_veille WHERE pathogene ILIKE :p AND traite = false LIMIT 1"),
            {"p": f"%{pathogene}%"},
        )).fetchone()

        if existing:
            await conn.execute(
                text("""
                    UPDATE emergence_veille
                    SET sources_count    = :cnt,
                        statut           = :statut,
                        derniere_mention = NOW(),
                        detail           = detail || :detail::jsonb
                    WHERE id = :id
                """),
                {"cnt": sources_count, "statut": statut,
                 "detail": json.dumps(detail), "id": existing[0]},
            )
        else:
            await conn.execute(
                text("""
                    INSERT INTO emergence_veille
                        (pathogene, localisation, transmission_interhumaine,
                         pertinence_rdc, sources_count, statut, detail)
                    VALUES
                        (:pathogene, :localisation, :h2h, :pertinence,
                         :cnt, :statut, :detail::jsonb)
                """),
                {
                    "pathogene":    pathogene,
                    "localisation": signal.get("localisation"),
                    "h2h":          signal.get("transmission_interhumaine"),
                    "pertinence":   signal.get("pertinence_rdc", "faible"),
                    "cnt":          sources_count,
                    "statut":       statut,
                    "detail":       json.dumps(detail),
                },
            )

    return statut


def _est_pathogene_connu(nom: str) -> bool:
    """Vérifie si le nom correspond à une maladie déjà dans le référentiel."""
    n = nom.lower()
    return any(connu in n or n in connu for connu in NOMS_CONNUS)


# ── Agent principal ────────────────────────────────────────────────────────────

class DetecteurEmergence:
    """
    Boucle asyncio toutes les 2h — scanne les sources mondiales de veille précoce.
    Signale les pathogènes INCONNUS avec logique de corroboration progressive.
    """

    def __init__(self) -> None:
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.get_event_loop().create_task(self._boucle())
        logger.info("detecteur_emergence.started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()

    async def _boucle(self) -> None:
        while self._running:
            await self._cycle()
            await asyncio.sleep(2 * 3600)  # 2 heures

    async def _cycle(self) -> None:
        _STATUS["last_run"] = datetime.now(timezone.utc).isoformat()
        _STATUS["runs_total"] += 1
        total_signaux = 0

        for source_id, source_cfg in SOURCES_EMERGENCE.items():
            texte = await _fetch_rss(source_cfg["url"])
            if not texte:
                continue

            signaux = await _analyser_texte(texte)

            for signal in signaux:
                pathogene = signal.get("pathogene", "")
                if not pathogene or _est_pathogene_connu(pathogene):
                    continue

                try:
                    statut = await _upsert_emergence(signal, source_id)
                    emergence_record = {
                        **signal,
                        "source": source_id,
                        "statut": statut,
                        "detecte_le": datetime.now(timezone.utc).isoformat(),
                    }
                    _EMERGENCE_STORE.append(emergence_record)
                    total_signaux += 1

                    # Publier sur le bus si corroboré (nécessite validation humaine)
                    if statut == "EMERGENCE_CORROBOREE":
                        await bus.publish("emergence.alerte", emergence_record)
                        logger.warning(
                            "detecteur_emergence.corroboree",
                            pathogene=pathogene,
                            pertinence_rdc=signal.get("pertinence_rdc"),
                        )
                    else:
                        logger.info(
                            "detecteur_emergence.signal",
                            pathogene=pathogene,
                            statut=statut,
                            source=source_id,
                        )
                except Exception as exc:
                    logger.warning("detecteur_emergence.upsert_error", error=str(exc))

        _STATUS["signaux_detectes"] += total_signaux

    def get_emergences(self, statut: str | None = None) -> list[dict]:
        if statut:
            return [e for e in _EMERGENCE_STORE if e.get("statut") == statut]
        return list(_EMERGENCE_STORE)

    def get_status(self) -> dict:
        return dict(_STATUS)


# Singleton
detecteur_emergence = DetecteurEmergence()
