"""
AgentResponsables — veille presse sur les nominations de responsables administratifs RDC.

Cycle toutes les 12 heures :
  1. Télécharge les flux RSS des médias congolais (Actualité.cd, Radio Okapi, 7sur7, etc.)
  2. Détecte les articles de nomination/révocation via Claude (pré-filtre + LLM)
  3. Rattache l'entité administrative aux admin_divisions (asyncpg)
  4. Enregistre les propositions dans responsable_proposition (statut A_VALIDER)
  5. Publie sur Redis si confiance > 0.8

Table : responsable_proposition
Bus   : responsable.nomination (publié pour les nominations haute confiance)
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import asyncpg
import structlog

from config import settings
from redis_client import get_redis
from .sources import SOURCES_PRESSE

logger = structlog.get_logger(__name__)


class AgentResponsables:
    """Surveille la presse congolaise pour détecter les nominations administratives."""

    INTERVAL_HOURS = 12

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._pool: asyncpg.Pool | None = None
        self._redis = None
        # stats
        self.dernier_cycle: str | None = None
        self.nb_propositions_creees: int = 0
        self.nb_articles_analyses: int = 0
        self.nb_changements_detectes: int = 0
        self.dernier_suivi: str | None = None

    async def start(self) -> None:
        """Initialise le pool asyncpg et démarre la boucle de veille."""
        if self._task is not None and not self._task.done():
            return
        try:
            self._pool = await asyncpg.create_pool(
                settings.database_url,
                min_size=1,
                max_size=3,
            )
            logger.info("agent_responsables.pool_created")
        except Exception as exc:
            logger.warning("agent_responsables.pool_error", error=str(exc))

        try:
            self._redis = get_redis()
        except Exception as exc:
            logger.warning("agent_responsables.redis_error", error=str(exc))

        self._task = asyncio.get_event_loop().create_task(self._run())
        logger.info("agent_responsables.started")

    async def stop(self) -> None:
        """Annule la tâche et ferme le pool."""
        if self._task:
            self._task.cancel()
            self._task = None
        if self._pool:
            try:
                await self._pool.close()
            except Exception:
                pass
            self._pool = None
        logger.info("agent_responsables.stopped")

    async def _run(self) -> None:
        """Boucle infinie : un cycle toutes les INTERVAL_HOURS heures."""
        while True:
            try:
                await self._cycle()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("agent_responsables.cycle_exception", error=str(exc))
            await asyncio.sleep(self.INTERVAL_HOURS * 3600)

    async def _cycle(self) -> None:
        """Un cycle complet de collecte, analyse et enregistrement."""
        from .collecteur_presse import collecteur_presse
        from .detecteur_nominations import detecteur_nominations
        from .rapprochement import rapprocher_entite

        self.dernier_cycle = datetime.now(timezone.utc).isoformat()
        logger.info("agent_responsables.cycle_start")

        for source_id, config in SOURCES_PRESSE.items():
            try:
                articles = await collecteur_presse.fetch_articles(source_id, config)
            except Exception as exc:
                logger.warning("agent_responsables.fetch_error", source_id=source_id, error=str(exc))
                continue

            for article in articles:
                self.nb_articles_analyses += 1
                try:
                    nomination = await detecteur_nominations.analyser_article(
                        article['texte'], source_id
                    )
                except Exception as exc:
                    logger.warning(
                        "agent_responsables.analyse_error",
                        source_id=source_id,
                        error=str(exc),
                    )
                    continue

                if not nomination:
                    continue

                try:
                    if self._pool:
                        nomination = await rapprocher_entite(nomination, self._pool)
                    else:
                        nomination['statut_rapprochement'] = 'ENTITE_INTROUVABLE'
                except Exception as exc:
                    logger.warning(
                        "agent_responsables.rapprochement_error",
                        source_id=source_id,
                        error=str(exc),
                    )
                    nomination['statut_rapprochement'] = 'ENTITE_INTROUVABLE'

                try:
                    if await self._existe_deja(nomination):
                        continue
                except Exception as exc:
                    logger.warning(
                        "agent_responsables.existe_deja_error",
                        source_id=source_id,
                        error=str(exc),
                    )
                    continue

                try:
                    await self._enregistrer_proposition(nomination, article['url'])
                    self.nb_propositions_creees += 1
                    logger.info(
                        "agent_responsables.proposition_creee",
                        personne=nomination.get('personne'),
                        entite=nomination.get('entite'),
                        statut=nomination.get('statut_rapprochement'),
                    )
                except Exception as exc:
                    logger.warning(
                        "agent_responsables.enregistrement_error",
                        source_id=source_id,
                        error=str(exc),
                    )
                    continue

                # Notification Redis si confiance élevée
                if nomination.get('confiance', 0) > 0.8 and self._redis:
                    try:
                        await self._redis.publish(
                            'responsable.nomination',
                            json.dumps({
                                'personne': nomination.get('personne'),
                                'entite': nomination.get('entite'),
                                'pcode': nomination.get('pcode'),
                                'source': source_id,
                            }),
                        )
                    except Exception as exc:
                        logger.warning(
                            "agent_responsables.redis_publish_error",
                            error=str(exc),
                        )

        # Vérification des changements de responsables
        if self._pool:
            try:
                from .suivi_changements import suivi_changements
                nb = await suivi_changements.verifier_changements(self._pool)
                self.nb_changements_detectes += nb
                self.dernier_suivi = datetime.now(timezone.utc).isoformat()
                logger.info("agent_responsables.suivi_done", nb_changements=nb)
            except Exception as exc:
                logger.warning("agent_responsables.suivi_error", error=str(exc))

        logger.info(
            "agent_responsables.cycle_done",
            nb_propositions=self.nb_propositions_creees,
            nb_articles=self.nb_articles_analyses,
            nb_changements=self.nb_changements_detectes,
        )

    async def _existe_deja(self, nomination: dict) -> bool:
        """Vérifie si même personne + même pcode déjà en A_VALIDER."""
        pcode = nomination.get('pcode')
        personne = nomination.get('personne', '')
        if not pcode or not personne:
            return False
        if not self._pool:
            return False
        row = await self._pool.fetchrow(
            "SELECT id FROM responsable_proposition WHERE pcode=$1 AND personne ILIKE $2 AND statut='A_VALIDER'",
            pcode,
            personne,
        )
        return row is not None

    async def _enregistrer_proposition(self, nomination: dict, url_article: str) -> None:
        """Insère une proposition dans responsable_proposition."""
        if not self._pool:
            logger.warning("agent_responsables.no_pool")
            return

        # Gestion date_acte : None ou string "YYYY-MM-DD"
        date_acte_raw = nomination.get('date_acte')
        date_acte = None
        if date_acte_raw:
            try:
                from datetime import date
                date_acte = date.fromisoformat(str(date_acte_raw))
            except Exception:
                date_acte = None

        # Champs exclus du JSON detail
        _CHAMPS_PRINCIPAUX = {
            'pcode', 'personne', 'fonction', 'acte', 'date_acte',
            'interimaire', 'remplace', 'source', 'confiance',
            'statut_rapprochement', 'candidats', 'entite', 'nomination',
        }

        await self._pool.execute(
            """
            INSERT INTO responsable_proposition
              (pcode, entite_nom, personne, fonction, type_acte, date_acte,
               interimaire, remplace, source, url_article, confiance,
               statut_rapprochement, candidats, detail)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            """,
            nomination.get('pcode'),
            nomination.get('entite'),
            nomination.get('personne'),
            nomination.get('fonction'),
            nomination.get('acte'),
            date_acte,
            nomination.get('interimaire', False),
            nomination.get('remplace'),
            nomination.get('source'),
            url_article,
            nomination.get('confiance'),
            nomination.get('statut_rapprochement', 'CERTAIN'),
            json.dumps(nomination.get('candidats')) if nomination.get('candidats') else None,
            json.dumps({k: v for k, v in nomination.items() if k not in _CHAMPS_PRINCIPAUX}),
        )

    def get_status(self) -> dict:
        return {
            'actif': self._task is not None and not self._task.done(),
            'dernier_cycle': self.dernier_cycle,
            'nb_propositions_creees': self.nb_propositions_creees,
            'nb_articles_analyses': self.nb_articles_analyses,
            'nb_changements_detectes': self.nb_changements_detectes,
            'dernier_suivi': self.dernier_suivi,
            'interval_hours': self.INTERVAL_HOURS,
        }


agent_responsables = AgentResponsables()
