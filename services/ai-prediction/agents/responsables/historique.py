"""
ReconstituteurHistorique — fouille les archives de presse pour reconstituer
la succession des responsables d'une entité dans le temps.

Insère dans responsable_mandat. Ne touche pas responsable_proposition.
Cycle : déclenché manuellement via API ou via le scheduler hebdomadaire de l'agent.
"""
from __future__ import annotations

import structlog

logger = structlog.get_logger(__name__)


class ReconstituteurHistorique:

    async def reconstituer_entite(self, pcode: str, nom_entite: str, pool) -> list[dict]:
        """
        Cherche dans les archives les nominations historiques pour cette entité
        et reconstruit la chronologie dans responsable_mandat.
        """
        from .collecteur_presse import collecteur_presse
        from .detecteur_nominations import detecteur_nominations

        requetes = [
            f'bourgmestre {nom_entite} nommé',
            f'gouverneur {nom_entite} arrêté',
            f'administrateur territoire {nom_entite}',
            f'{nom_entite} installé responsable',
            f'{nom_entite} nomination',
        ]

        mentions: list[dict] = []
        seen_urls: set[str] = set()

        for requete in requetes:
            try:
                articles = await collecteur_presse.rechercher_archives(requete, depuis_annee=2019)
            except Exception as exc:
                logger.warning("historique.search_error", query=requete, error=str(exc))
                continue

            for article in articles:
                url = article.get('url', '')
                if url in seen_urls:
                    continue
                seen_urls.add(url)

                try:
                    nomination = await detecteur_nominations.analyser_article(
                        article['texte'], article.get('source_id', 'archive')
                    )
                except Exception as exc:
                    logger.warning("historique.analyse_error", error=str(exc))
                    continue

                if not nomination or not nomination.get('nomination'):
                    continue

                nomination['date_article'] = article.get('date', '')
                nomination['url'] = url
                mentions.append(nomination)

        chronologie = self._construire_chronologie(mentions)

        for entree in chronologie:
            try:
                await self._enregistrer_mandat(pcode, entree, pool)
            except Exception as exc:
                logger.warning("historique.enregistrement_error", pcode=pcode, error=str(exc))

        logger.info("historique.reconstitution_done", pcode=pcode, nb_mandats=len(chronologie))
        return chronologie

    def _construire_chronologie(self, mentions: list[dict]) -> list[dict]:
        """Trie par date, déduplique, chaîne les mandats."""
        def sort_key(m: dict) -> str:
            return m.get('date_acte') or m.get('date_article', '') or ''

        tries = sorted(mentions, key=sort_key)
        chronologie: list[dict] = []

        for m in tries:
            if not self._est_doublon(m, chronologie):
                chronologie.append({
                    'personne':    m.get('personne', ''),
                    'fonction':    m.get('fonction'),
                    'date_debut':  m.get('date_acte') or m.get('date_article'),
                    'date_fin':    None,
                    'interimaire': m.get('interimaire', False),
                    'source':      m.get('source'),
                    'url':         m.get('url'),
                    'confiance':   m.get('confiance'),
                })

        # Chaîner : date_fin du précédent = date_debut du suivant
        for i in range(len(chronologie) - 1):
            chronologie[i]['date_fin'] = chronologie[i + 1]['date_debut']

        return chronologie

    def _est_doublon(self, mention: dict, chrono: list[dict]) -> bool:
        """Même personne dans la chronologie existante."""
        nom = (mention.get('personne') or '').lower().strip()
        if not nom:
            return True
        return any(
            (e.get('personne') or '').lower().strip() == nom
            for e in chrono
        )

    async def _enregistrer_mandat(self, pcode: str, entree: dict, pool) -> None:
        """Insère dans responsable_mandat si même pcode+personne absent."""
        from datetime import date as date_type

        def parse_date(d: str | None):
            if not d:
                return None
            try:
                return date_type.fromisoformat(str(d)[:10])
            except Exception:
                return None

        await pool.execute(
            """
            INSERT INTO responsable_mandat
              (pcode, personne, fonction, date_debut, date_fin,
               interimaire, source, url_source, confiance, statut)
            SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,'HISTORIQUE'
            WHERE NOT EXISTS (
                SELECT 1 FROM responsable_mandat
                WHERE pcode=$1 AND personne ILIKE $2
            )
            """,
            pcode,
            entree['personne'],
            entree.get('fonction'),
            parse_date(entree.get('date_debut')),
            parse_date(entree.get('date_fin')),
            entree.get('interimaire', False),
            entree.get('source'),
            entree.get('url'),
            entree.get('confiance'),
        )


reconstituteur_historique = ReconstituteurHistorique()
