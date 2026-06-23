"""
SuiviChangements — compare les responsables connus avec les articles récents
pour détecter les remplacements et créer des propositions de validation.
"""
from __future__ import annotations

import re

import structlog

logger = structlog.get_logger(__name__)


class SuiviChangements:

    @staticmethod
    def _normaliser(nom: str | None) -> str:
        """Normalise un nom pour comparaison (minuscules, sans accents)."""
        if not nom:
            return ''
        import unicodedata
        nfd = unicodedata.normalize('NFD', nom.lower())
        return re.sub(r'[̀-ͯ\s\-_.]', '', nfd)

    async def verifier_changements(self, pool) -> int:
        """
        Vérifie tous les responsables connus pour détecter des remplacements.
        Retourne le nombre de changements proposés.
        """
        from .collecteur_presse import collecteur_presse
        from .detecteur_nominations import detecteur_nominations

        try:
            responsables = await pool.fetch("""
                SELECT pcode, name_fr, responsable_nom, responsable_titre, responsable_maj_le
                FROM admin_divisions
                WHERE responsable_nom IS NOT NULL AND is_active = TRUE
                LIMIT 200
            """)
        except Exception as exc:
            logger.warning("suivi.fetch_responsables_error", error=str(exc))
            return 0

        nb_changements = 0

        for resp in responsables:
            pcode = resp['pcode']
            nom_entite = resp['name_fr'] or pcode
            nom_actuel = resp['responsable_nom']

            depuis_date = None
            if resp['responsable_maj_le']:
                depuis_date = resp['responsable_maj_le'].strftime('%Y-%m-%d')

            try:
                articles = await collecteur_presse.rechercher_archives(
                    f'{nom_entite} bourgmestre OR gouverneur OR administrateur',
                    depuis_date=depuis_date,
                )
            except Exception as exc:
                logger.warning("suivi.search_error", pcode=pcode, error=str(exc))
                continue

            for article in articles:
                try:
                    nomination = await detecteur_nominations.analyser_article(
                        article['texte'], article.get('source_id', 'archive')
                    )
                except Exception as exc:
                    logger.warning("suivi.analyse_error", pcode=pcode, error=str(exc))
                    continue

                if not nomination or not nomination.get('nomination'):
                    continue

                # Même personne → pas un changement
                nouveau_nom = nomination.get('personne', '')
                if self._normaliser(nouveau_nom) == self._normaliser(nom_actuel):
                    continue

                # Changement détecté → créer une proposition
                try:
                    await self._proposer_changement(
                        pcode=pcode,
                        nom_entite=nom_entite,
                        ancien_nom=nom_actuel,
                        nomination=nomination,
                        url_article=article.get('url', ''),
                        pool=pool,
                    )
                    nb_changements += 1
                    logger.info(
                        "suivi.changement_detecte",
                        pcode=pcode,
                        entite=nom_entite,
                        ancien=nom_actuel,
                        nouveau=nouveau_nom,
                    )
                except Exception as exc:
                    logger.warning("suivi.proposition_error", pcode=pcode, error=str(exc))

                break  # Une seule proposition par entité par cycle

        return nb_changements

    async def _proposer_changement(self, pcode, nom_entite, ancien_nom, nomination, url_article, pool):
        """Crée une proposition de changement dans responsable_proposition."""
        import json
        from datetime import date as date_type

        date_acte_raw = nomination.get('date_acte')
        date_acte = None
        if date_acte_raw:
            try:
                date_acte = date_type.fromisoformat(str(date_acte_raw)[:10])
            except Exception:
                date_acte = None

        # Vérifier que cette proposition n'existe pas déjà
        existing = await pool.fetchrow(
            """SELECT id FROM responsable_proposition
               WHERE pcode=$1 AND personne ILIKE $2 AND statut='A_VALIDER'""",
            pcode, nomination.get('personne', '')
        )
        if existing:
            return

        await pool.execute(
            """
            INSERT INTO responsable_proposition
              (pcode, entite_nom, personne, fonction, type_acte, date_acte,
               interimaire, remplace, source, url_article, confiance,
               statut_rapprochement, statut, detail)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CERTAIN','A_VALIDER',$12)
            """,
            pcode,
            nom_entite,
            nomination.get('personne'),
            nomination.get('fonction'),
            nomination.get('acte'),
            date_acte,
            nomination.get('interimaire', False),
            ancien_nom,   # l'actuel devient le "remplacé"
            nomination.get('source'),
            url_article,
            nomination.get('confiance'),
            json.dumps({'type': 'CHANGEMENT', 'ancien': ancien_nom}),
        )


suivi_changements = SuiviChangements()
