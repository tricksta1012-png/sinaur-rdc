"""
Résolution des acteurs ACLED vers le référentiel interne.
Correspondance exacte d'abord, puis Jaro-Winkler (seuil 0.88).
"""
from __future__ import annotations

from agents.conflit.data.armed_actors_rdc import ACTORS_BY_ALIAS
from agents.conflit.schemas.conflict import ActorRole, ArmedActor, DataClassification


def resolve_actor(acled_actor_name: str, zone_operation: str = "") -> ArmedActor | None:
    """
    Résout un nom d'acteur ACLED vers le référentiel interne.
    Retourne None si le nom est vide.
    Retourne un ArmedActor générique RESTRICTED si aucune correspondance n'est trouvée.
    """
    if not acled_actor_name or not acled_actor_name.strip():
        return None

    key = acled_actor_name.upper().strip()

    # Correspondance exacte sur alias
    if key in ACTORS_BY_ALIAS:
        data = ACTORS_BY_ALIAS[key]
        return _build_actor(data, zone_operation, source_fiabilite=0.90)

    # Correspondance approximative Jaro-Winkler, seuil 0.88
    try:
        from jellyfish import jaro_winkler_similarity
        best_data = None
        best_score = 0.0
        for alias, data in ACTORS_BY_ALIAS.items():
            score = jaro_winkler_similarity(key, alias)
            if score > best_score:
                best_score = score
                best_data = data

        if best_score >= 0.88 and best_data is not None:
            return _build_actor(
                best_data,
                zone_operation,
                source_fiabilite=round(best_score * 0.90, 3),
            )
    except ImportError:
        pass

    # Acteur inconnu — ArmedActor générique RESTRICTED
    return ArmedActor(
        categorie="groupe_arme_inconnu",
        zone_operation=zone_operation,
        nom_acled=acled_actor_name,
        nom_alternatifs=[],
        role=ActorRole.INITIATEUR,
        source_fiabilite=0.70,
        provinces_actives=[],
        type_violence_frequent="Inconnu",
        nb_evenements_acled_1an=0,
        tendance_activite="STABLE",
        classification=DataClassification.RESTRICTED,
    )


def _build_actor(data: dict, zone_operation: str, source_fiabilite: float) -> ArmedActor:
    return ArmedActor(
        categorie=data["categorie"],
        zone_operation=zone_operation,
        nom_acled=data["nom_acled"],
        nom_alternatifs=data["nom_alternatifs"],
        role=ActorRole.INITIATEUR,
        source_fiabilite=source_fiabilite,
        provinces_actives=data["provinces_actives_historique"],
        type_violence_frequent=data["type_violence_frequent"],
        nb_evenements_acled_1an=0,    # calculé à l'agrégation
        tendance_activite="STABLE",   # calculé depuis l'historique
        classification=DataClassification.RESTRICTED,
    )
