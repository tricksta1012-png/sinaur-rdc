"""
Analyse stratégique complète — synthèse IA des deux dynamiques.

Séparation stricte :
  - Progression armée  → objectifs du groupe, cibles de valeur
  - Déplacement civil  → sécurité proche, jamais Kinshasa par défaut
"""
from __future__ import annotations

import os

import anthropic
import structlog

from agents.conflit.strategie.logiques_deplacement import (
    LOGIQUES,
    classifier_evenement,
    get_objectifs,
)
from agents.conflit.strategie.projection_civile import projeter_fuite_civile
from agents.conflit.strategie.projection_armee import projeter_progression_armee

logger = structlog.get_logger(__name__)

_ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")

SYSTEM_PROMPT = """Tu es analyste militaire et humanitaire pour SINAUR-RDC (Système National d'Alerte et d'Urgence — République Démocratique du Congo).

On te donne :
- Un ÉVÉNEMENT (incident de conflit ou déplacement)
- Le GROUPE ARMÉ impliqué et ses objectifs documentés
- Les CIBLES STRATÉGIQUES probables calculées par le système
- Les DESTINATIONS DE FUITE CIVILE probables calculées par le système

Produis une analyse en deux volets DISTINCTS :

**1. PROGRESSION ARMÉE** (si un groupe est impliqué) :
- Rappelle l'objectif stratégique réel du groupe
- Valide ou nuance les cibles calculées par le système
- Explique POURQUOI ce groupe progresserait vers ces cibles (ressource, axe, frontière)
- NE DIS PAS "vers Kinshasa" sauf si le groupe vise réellement la capitale (seul Mobondo a une expansion documentée vers Maluku/Kinshasa)

**2. DÉPLACEMENT CIVIL** :
- Vers où les populations vont-elles fuir ? (sécurité PROCHE, pas la capitale)
- Quels axes routiers surveiller (colonnes de déplacés) ?
- Quelles zones d'accueil vont être sous pression humanitaire ?

**RÈGLES ABSOLUES** :
- Distingue TOUJOURS progression armée et fuite civile (logiques opposées)
- Donne des HYPOTHÈSES avec raisonnement, jamais des certitudes
- Si tu manques d'info sur un groupe, dis-le plutôt que d'inventer
- Sois concis : 3-4 paragraphes maximum, ton analytique et factuel
- Indique systématiquement le niveau de confiance (élevé/moyen/faible) de tes hypothèses

Format de sortie : texte structuré avec les deux sections clairement séparées."""


async def analyser_strategiquement(evenement: dict, acteurs: list[str]) -> dict:
    """
    Analyse stratégique complète d'un événement conflit.

    Args:
        evenement: dict avec titre, description, p_code, province, coordinates, actor_names, etc.
        acteurs: liste des noms ACLED des acteurs impliqués.

    Returns:
        dict avec progression_armee, fuite_civile, synthese_ia.
    """
    province = evenement.get("province") or evenement.get("territoire") or "Zone inconnue"
    p_code = evenement.get("p_code")
    coords_raw = evenement.get("coordinates")
    coords: tuple[float, float] | None = None
    if isinstance(coords_raw, (list, tuple)) and len(coords_raw) >= 2:
        coords = (float(coords_raw[0]), float(coords_raw[1]))

    logiques = classifier_evenement(evenement)

    # 1. Projection civile
    fuite = await projeter_fuite_civile(province, p_code, coords)

    # 2. Projections armées pour chaque acteur
    progressions: list[dict] = []
    if "PROGRESSION_ARMEE" in logiques and acteurs:
        for acteur in acteurs[:2]:  # max 2 acteurs
            prog = await projeter_progression_armee(acteur, p_code, coords)
            progressions.append(prog)
    elif "PROGRESSION_ARMEE" in logiques:
        # Groupe non identifié — analyse générique
        progressions.append({
            "groupe":           "Groupe non identifié",
            "objectif_connu":   "Non documenté",
            "logique_groupe":   "",
            "vise_capitale":    False,
            "cibles_probables": [],
            "raisonnement":     "Groupe non résolu dans le référentiel SINAUR. Consulter les sources terrain.",
            "note":             "Enrichir la base de connaissance avec une fiche sur ce groupe.",
        })

    # 3. Synthèse IA (si clé API disponible)
    synthese_ia: str | None = None
    if _ANTHROPIC_KEY and (progressions or fuite):
        try:
            synthese_ia = await _synthese_claude(evenement, acteurs, progressions, fuite)
        except Exception as exc:
            logger.warning("strategie.claude_failed", error=str(exc))
            synthese_ia = None

    return {
        "logiques_identifiees": logiques,
        "progression_armee":    progressions[0] if progressions else None,
        "progressions_toutes":  progressions,
        "fuite_civile":         fuite,
        "synthese_ia":          synthese_ia,
        "source":               "SINAUR-RDC Intelligence Stratégique v1",
    }


async def _synthese_claude(
    evenement: dict,
    acteurs: list[str],
    progressions: list[dict],
    fuite: dict,
) -> str:
    client = anthropic.Anthropic(api_key=_ANTHROPIC_KEY)

    acteur_info = []
    for p in progressions:
        obj = get_objectifs(p["groupe"])
        acteur_info.append(
            f"Groupe : {p['groupe']}\n"
            f"Objectif : {obj.get('objectif_primaire', 'N/A')}\n"
            f"Logique : {obj.get('logique', 'N/A')}\n"
            f"Vise Kinshasa : {'OUI (exception documentée)' if obj.get('vise_capitale') else 'NON'}\n"
            f"Cibles probables calculées : {[c['nom'] for c in p['cibles_probables'][:2]]}"
        )

    user_content = (
        f"ÉVÉNEMENT : {evenement.get('titre') or evenement.get('event_type', 'Incident')}\n"
        f"LIEU : {evenement.get('territoire') or evenement.get('province', 'N/A')}\n"
        f"DESCRIPTION : {(evenement.get('raw_notes') or evenement.get('description') or '')[:400]}\n\n"
        + "\n\n".join(acteur_info) + "\n\n"
        f"CIBLES STRATÉGIQUES CALCULÉES :\n"
        + "\n".join(
            f"- {c['nom']} ({c['type_valeur']}, {c.get('ressource', '')}, dist. ~{int(c['distance_km'])} km)"
            for prog in progressions for c in prog["cibles_probables"][:2]
        ) + "\n\n"
        f"DESTINATIONS FUITE CIVILE CALCULÉES :\n"
        f"- Refuges proches : {[d['nom'] for d in fuite['destinations_probables'][:3]]}\n"
        f"- Frontières : {[f['nom'] for f in fuite.get('frontieres_proches', [])[:2]]}\n"
        f"- Axes à surveiller : {fuite.get('axes_surveillance', [])}\n"
    )

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=900,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    return msg.content[0].text
