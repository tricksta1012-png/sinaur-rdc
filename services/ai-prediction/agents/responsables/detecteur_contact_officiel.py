"""
DetecteurContactOfficiel — détecte uniquement les contacts de SERVICE
publiés dans des sources officielles. Jamais de moissonnage de contacts personnels.
"""
from __future__ import annotations

import re

SOURCES_OFFICIELLES = {'journal_officiel', 'presidence', 'ministere_interieur'}

# Patterns d'emails institutionnels congolais
_EMAIL_OFFICIEL_RE = re.compile(r'[\w.+-]+@[\w.-]*(?:gouv|gov|cd|minfin|interieur)\.cd', re.IGNORECASE)
_TEL_SERVICE_RE    = re.compile(r'(?:tél|tel|bureau|service)\s*[:.]?\s*(\+?243\s*[\d\s]{7,12})', re.IGNORECASE)


class DetecteurContactOfficiel:
    """
    Ne cherche PAS les contacts personnels.
    Détecte seulement les contacts de SERVICE publiés dans des documents officiels.
    """

    def detecter_contact_officiel(self, texte: str, source: str) -> dict | None:
        """
        Analyse un texte de source officielle pour trouver un contact institutionnel.
        Retourne None si source non officielle ou aucun contact trouvé.
        """
        if source not in SOURCES_OFFICIELLES:
            return None

        emails = _EMAIL_OFFICIEL_RE.findall(texte)
        if emails:
            return {
                'contact':     emails[0],
                'type':        'email_officiel',
                'source':      source,
                'a_confirmer': True,
            }

        tels = _TEL_SERVICE_RE.findall(texte)
        if tels:
            return {
                'contact':     tels[0].strip(),
                'type':        'tel_service',
                'source':      source,
                'a_confirmer': True,
            }

        return None


detecteur_contact_officiel = DetecteurContactOfficiel()
