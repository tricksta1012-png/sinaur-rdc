"""
DetecteurNominations — analyse les articles de presse via Claude pour détecter
les nominations/révocations de responsables administratifs congolais.
"""
from __future__ import annotations

import json
import re

import structlog

from config import settings
from .sources import SIGNAUX_NOMINATION

logger = structlog.get_logger(__name__)

SYSTEM_PROMPT_NOMINATION = """Tu es analyste pour SINAUR-RDC.
On te donne un article de presse congolaise. Détermine s'il annonce une
NOMINATION, INSTALLATION ou RÉVOCATION d'un responsable administratif
(gouverneur, maire, administrateur de territoire, bourgmestre, chef de
secteur/chefferie).

Si OUI, extrais :
- nom complet de la personne
- fonction exacte
- entité concernée (province, ville, territoire, commune, secteur...)
- type d'acte (arrêté, ordonnance) et date si mentionnée
- si poste intérimaire ou titulaire
- personne remplacée si mentionnée

N'invente RIEN. Si l'article ne parle pas de nomination, réponds {"nomination": false}.

Format JSON strict :
{
  "nomination": true,
  "personne": "Nom complet",
  "fonction": "Bourgmestre",
  "entite": "Ngaliema",
  "type_entite": "commune",
  "interimaire": false,
  "acte": "Arrêté ministériel",
  "date_acte": "2025-04-29",
  "remplace": null,
  "confiance": 0.85
}"""


class DetecteurNominations:
    """Détecte les nominations de responsables administratifs dans les articles de presse."""

    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        """Lazy init du client Anthropic."""
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        return self._client

    async def analyser_article(self, texte: str, source_id: str) -> dict | None:
        """
        Analyse un article pour détecter une nomination.

        1. Pré-filtre sur les signaux de nomination.
        2. Appel Claude avec prompt spécialisé.
        3. Parse la réponse JSON.
        4. Retourne le dict si nomination == True, sinon None.
        """
        # Pré-filtre : évite les appels inutiles à l'API
        texte_lower = texte.lower()
        if not any(s in texte_lower for s in SIGNAUX_NOMINATION):
            return None

        try:
            message = self.client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=800,
                system=SYSTEM_PROMPT_NOMINATION,
                messages=[
                    {"role": "user", "content": texte[:4000]},  # limite raisonnable
                ],
            )
            response_text = message.content[0].text if message.content else ""
        except Exception as exc:
            logger.warning(
                "detecteur_nominations.api_error",
                source_id=source_id,
                error=str(exc),
            )
            return None

        try:
            result = self._parse_json(response_text)
        except Exception as exc:
            logger.warning(
                "detecteur_nominations.parse_error",
                source_id=source_id,
                response=response_text[:200],
                error=str(exc),
            )
            return None

        if result.get('nomination') is True:
            result['source'] = source_id
            return result
        return None

    def _parse_json(self, text: str) -> dict:
        """
        Extrait le bloc JSON de la réponse (peut être entouré de texte explicatif).
        """
        # Cherche un bloc ```json ... ``` ou ``` ... ```
        match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
        if match:
            return json.loads(match.group(1))

        # Cherche le premier { ... } dans le texte
        match = re.search(r'(\{.*\})', text, re.DOTALL)
        if match:
            return json.loads(match.group(1))

        # Dernier recours : parse directement
        return json.loads(text.strip())


detecteur_nominations = DetecteurNominations()
