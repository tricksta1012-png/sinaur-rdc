"""
Module centralisé de calcul de gravité pour evenement_flux.

Score 0-100 = TYPE (poids) × AMPLEUR (log scale) × FIABILITÉ.
Tous les agents qui écrivent dans evenement_flux importent depuis ici.
"""
from __future__ import annotations

import math

# Poids intrinsèque par type d'événement
_POIDS_TYPE: dict[str, float] = {
    "CONFLIT":       1.00,
    "MILITAIRE":     0.95,
    "EPIDEMIE":      0.85,
    "CATASTROPHE":   0.80,
    "SECURITE":      0.70,
    "RENSEIGNEMENT": 0.60,
    "HUMANITAIRE":   0.50,
    "AUTRE":         0.40,
}


def calculer_score(type_evt: str, ampleur: int, fiabilite: float) -> int:
    """
    Retourne un score de gravité 0-100.

    type_evt  : l'un des types evenement_flux (CONFLIT, EPIDEMIE, …)
    ampleur   : personnes affectées, victimes, cas confirmés, ou intensité proxy
    fiabilite : 0.0–1.0 (fiabilité de la source)
    """
    poids_type = _POIDS_TYPE.get(type_evt, 0.5)

    if ampleur <= 0:
        facteur_ampleur = 0.20
    else:
        # Échelle log : 10 → 0.40, 100 → 0.60, 1000 → 0.80, 10000+ → 1.00
        facteur_ampleur = min(1.0, 0.20 + 0.20 * math.log10(max(ampleur, 1)))

    score = 100.0 * poids_type * (0.5 + 0.3 * facteur_ampleur + 0.2 * float(fiabilite))
    return round(min(100.0, max(0.0, score)))


def score_to_gravite(score: int) -> str:
    """Traduit le score numérique en libellé TEXT compatible avec evenement_flux."""
    if score >= 60:
        return "CRITIQUE"
    if score >= 40:
        return "ELEVEE"
    return "NORMALE"


def statut_from_sources(nb_sources: int, corroboration: float = 0.0) -> str:
    """Statut de vérification standardisé."""
    if nb_sources >= 3 or corroboration >= 0.6:
        return "CORROBORE"
    if nb_sources >= 2 or corroboration >= 0.3:
        return "PROBABLE"
    return "A_CORROBORER"
