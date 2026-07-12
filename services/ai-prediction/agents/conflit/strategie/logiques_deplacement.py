"""
Deux logiques de déplacement à ne jamais confondre.

FUITE_CIVILE  — les populations cherchent la sécurité la plus PROCHE.
PROGRESSION_ARMEE — les groupes armés progressent vers ce qui a de la VALEUR
                     (mines, axes commerciaux, frontières, villes-relais).

Aucune des deux logiques ne pointe mécaniquement vers Kinshasa sauf exception
documentée (Mobondo est le seul groupe dont l'expansion touche la périphérie
de Kinshasa).
"""
from __future__ import annotations

LOGIQUES: dict[str, dict] = {
    "FUITE_CIVILE": {
        "acteur":           "population civile",
        "objectif":         "sécurité immédiate",
        "destination_type": "ville sûre la plus proche, camp de déplacés, frontière",
        "regle": (
            "Distance minimale vers la sécurité. "
            "PAS vers la capitale — un déplacé de l'Est va à Goma ou dans un camp, "
            "jamais à Kinshasa (1 600 km)."
        ),
    },
    "PROGRESSION_ARMEE": {
        "acteur":           "groupe armé / milice",
        "objectif":         "contrôle de ressources ou territoire stratégique",
        "destination_type": "cible de valeur : mine, axe commercial, frontière, ville-relais",
        "regle": (
            "Maximiser le gain stratégique (ressources, revenus, mobilité). "
            "PAS occuper la capitale — sauf Mobondo dont l'expansion touche Maluku."
        ),
    },
}

# Objectifs stratégiques spécifiques à chaque groupe
# Clé = nom ACLED exact (doit correspondre à armed_actors_rdc.py)
OBJECTIFS_PAR_GROUPE: dict[str, dict] = {
    "M23/AFC": {
        "objectif_primaire":  "Contrôle des axes commerciaux et zones minières du Nord-Kivu",
        "ressources_cibles":  ["coltan", "cassitérite", "routes commerciales"],
        "types_valeur":       ["MINE", "AXE_COMMERCIAL", "FRONTIERE", "VILLE_RELAIS"],
        "vise_capitale":      False,
        "logique":            "Conquête territoriale structurée, tient le terrain, ville par ville.",
        "note":               "Vise le contrôle de l'Est, pas Kinshasa. Rubaya (coltan) est la cible économique centrale.",
    },
    "ADF": {
        "objectif_primaire":  "Survie organisationnelle, prédation locale, terreur",
        "ressources_cibles":  ["pillage", "taxation populations", "recrutement"],
        "types_valeur":       ["BASTION", "VILLE_RELAIS"],
        "vise_capitale":      False,
        "logique":            "Attaques mobiles, se replie en forêt. Pas de tenue de territoire fixe.",
        "note":               "Zone Beni/Grand Nord, extension Ituri. Financement par pillage et taxe informelle.",
    },
    "CODECO": {
        "objectif_primaire":  "Contrôle des zones aurifères de l'Ituri",
        "ressources_cibles":  ["or"],
        "types_valeur":       ["MINE", "AGRICOLE"],
        "vise_capitale":      False,
        "logique":            "Dimension communautaire Lendu/Hema + contrôle économique des sites miniers.",
        "note":               "Pic d'activité 2019–2021. Conflits intercommunautaires récurrents.",
    },
    "Mobondo": {
        "objectif_primaire":  "Contrôle foncier et expansion territoriale locale",
        "ressources_cibles":  ["terres", "redevances coutumières"],
        "types_valeur":       ["AGRICOLE", "VILLE_RELAIS"],
        "vise_capitale":      True,  # Seul groupe touchant la périphérie de Kinshasa (Maluku)
        "logique":            "Conflit foncier Teke-Yaka. Extension vers Kinshasa (Maluku) et Kongo-Central.",
        "note":               "Seul groupe dont l'expansion touche réellement les portes de Kinshasa (Maluku). "
                              "Ne pas généraliser cette exception à tous les autres groupes.",
    },
    "FDLR-FOCA": {
        "objectif_primaire":  "Survie en territoire congolais, prédation minière",
        "ressources_cibles":  ["cassitérite", "or", "taxation mineurs"],
        "types_valeur":       ["MINE", "BASTION"],
        "vise_capitale":      False,
        "logique":            "Présence ancienne dans les Kivus. Taxation des mineurs artisanaux.",
        "note":               "Les opérations FARDC contre le FDLR génèrent souvent des déplacements civils.",
    },
    "Wazalendo": {
        "objectif_primaire":  "Résistance au M23, défense communautaire locale",
        "ressources_cibles":  ["territoire local"],
        "types_valeur":       ["VILLE_RELAIS", "AXE_COMMERCIAL"],
        "vise_capitale":      False,
        "logique":            "Milices d'autodéfense alliées variables des FARDC. Contrôle local et défensif.",
        "note":               "Alliance instable avec les FARDC. Progressions défensives, pas expansionnistes.",
    },
    "FARDC": {
        "objectif_primaire":  "Reprise du territoire national, contrer les groupes armés",
        "ressources_cibles":  [],
        "types_valeur":       ["VILLE_RELAIS", "AXE_COMMERCIAL"],
        "vise_capitale":      False,
        "logique":            "Forces nationales. Opérations génèrent parfois des déplacements civils temporaires.",
        "note":               "Suivi pour coordination humanitaire uniquement.",
    },
}


def get_objectifs(nom_acled: str) -> dict:
    """Retourne les objectifs stratégiques connus pour un groupe, ou un dict générique."""
    obj = OBJECTIFS_PAR_GROUPE.get(nom_acled)
    if obj:
        return obj
    # Cherche par alias partiel
    nom_upper = nom_acled.upper()
    for key, val in OBJECTIFS_PAR_GROUPE.items():
        if nom_upper in key.upper() or key.upper() in nom_upper:
            return val
    return {
        "objectif_primaire":  "Objectifs non documentés dans le référentiel SINAUR",
        "ressources_cibles":  [],
        "types_valeur":       [],
        "vise_capitale":      False,
        "logique":            "Information insuffisante — consulter les sources terrain.",
        "note":               "Ajouter une fiche dans la base de connaissance pour ce groupe.",
    }


def classifier_evenement(evenement: dict) -> list[str]:
    """
    Détermine quelle(s) logique(s) s'applique(nt) à un événement.
    Un même événement peut impliquer les deux (attaque → fuite civile + progression armée).
    """
    logiques = []
    evt_type = str(evenement.get("event_type", "")).lower()
    categories = [str(c).lower() for c in (evenement.get("actor_names") or [])]
    has_actors = bool(evenement.get("actor_names"))

    # Progression armée : si un groupe armé est impliqué dans un incident actif
    if has_actors or "conflit" in evt_type or "battle" in evt_type or "clash" in evt_type:
        logiques.append("PROGRESSION_ARMEE")

    # Fuite civile : si déplacement mentionné ou risque élevé
    dr = float(evenement.get("displacement_risk", 0))
    if "deplacement" in evt_type or "displacement" in evt_type or dr >= 0.5:
        logiques.append("FUITE_CIVILE")

    # Par défaut, analyser les deux
    if not logiques:
        logiques = ["PROGRESSION_ARMEE", "FUITE_CIVILE"]

    return logiques
