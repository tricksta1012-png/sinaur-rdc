"""
ExtracteurMultiMaladies — extraction LLM d'un bulletin → plusieurs maladies.

Un rapport OCHA peut couvrir choléra, rougeole et Ebola dans le même document.
Le prompt générique identifie TOUTES les maladies avec des chiffres, sans a priori.

Nécessite : ANTHROPIC_API_KEY dans l'environnement.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

import structlog

from agents.epidemie.referentiel import MALADIES_SUIVIES

logger = structlog.get_logger(__name__)

SYSTEM_PROMPT_MULTI = """Tu es analyste épidémiologique pour SINAUR-RDC (République Démocratique du Congo).
On te donne le texte d'un bulletin sanitaire officiel. Il peut parler de PLUSIEURS maladies à la fois.

Ta tâche :
1. Identifie CHAQUE maladie mentionnée avec des chiffres.
2. Pour chacune, extrais les chiffres explicites (cas confirmés, suspects, décès).
3. Note la zone géographique et la date du rapport.
4. N'invente JAMAIS un chiffre absent. Mets null si non mentionné.

Réponds UNIQUEMENT en JSON valide, sans commentaire :
{
  "date_rapport": "AAAA-MM-JJ ou null",
  "source_citee": "OMS | INSP | OCHA | etc.",
  "maladies": [
    {
      "nom": "Ebola",
      "souche": "Bundibugyo ou null",
      "cas_confirmes": 12,
      "cas_suspects": 5,
      "deces": 3,
      "provinces": ["Ituri", "Nord-Kivu"],
      "zones_sante": [{"nom": "Bunia", "cas_confirmes": 8}],
      "confiance": 0.95
    }
  ]
}"""


class ExtracteurMultiMaladies:
    """Extrait toutes les maladies d'un bulletin avec l'API Claude."""

    def __init__(self) -> None:
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            try:
                import anthropic
                from config import settings
                api_key = getattr(settings, 'anthropic_api_key', '')
                if not api_key:
                    raise ValueError("ANTHROPIC_API_KEY non configurée")
                self._client = anthropic.Anthropic(api_key=api_key)
            except ImportError:
                raise RuntimeError("Package 'anthropic' manquant — ajouter dans requirements.txt")
        return self._client

    async def extraire(self, texte: str) -> dict[str, Any]:
        """Appel Claude pour extraire toutes les maladies du texte."""
        client = self._get_client()
        try:
            message = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=3000,
                system=SYSTEM_PROMPT_MULTI,
                messages=[{"role": "user", "content": texte[:8000]}],
            )
            raw = message.content[0].text
            return self._parse_json(raw)
        except Exception as exc:
            logger.warning("extracteur_multi.llm_error", error=str(exc))
            return {"maladies": []}

    def _parse_json(self, text: str) -> dict[str, Any]:
        # Extraire le bloc JSON même si Claude ajoute du texte autour
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
        return {"maladies": []}

    def router_vers_maladie(self, nom_extrait: str) -> str | None:
        """Fait correspondre un nom extrait à un code maladie du référentiel."""
        nom_lower = nom_extrait.lower()
        for code, config in MALADIES_SUIVIES.items():
            if any(
                n.lower() in nom_lower or nom_lower in n.lower()
                for n in config['noms']
            ):
                return code
        return None


# Singleton
extracteur_multi = ExtracteurMultiMaladies()
