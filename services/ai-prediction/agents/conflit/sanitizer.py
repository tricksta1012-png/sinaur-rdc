"""
Sérialisation des ConflictEvent par niveau d'accès RBAC.
Les champs RESTRICTED sont absents de la réponse (pas juste masqués).
"""
from __future__ import annotations

from agents.conflit.schemas.conflict import ArmedActor, ConflictEvent, DataClassification

# Rôles (alignés sur users.role dans la base SINAUR-RDC)
_ROLE_ACCESS: dict[str, DataClassification] = {
    "citizen":                   DataClassification.PUBLIC,
    "field_agent":               DataClassification.INTERNAL,
    "local_validator":           DataClassification.INTERNAL,
    "territory_admin":           DataClassification.INTERNAL,
    "humanitarian_partner":      DataClassification.RESTRICTED,
    "national_decision_maker":   DataClassification.RESTRICTED,
    "system_admin":              DataClassification.CONFIDENTIAL,
}

_DISCLAIMER = (
    "Données issues de sources publiques institutionnelles "
    "(ACLED, OCHA, MONUSCO). Usage strictement humanitaire — "
    "coordination de la réponse aux déplacements de populations civiles. "
    "Ne pas redistribuer hors cadre humanitaire accrédité."
)


def access_level_for_role(role: str) -> DataClassification:
    """Retourne le niveau d'accès maximal pour un rôle donné."""
    return _ROLE_ACCESS.get(role, DataClassification.PUBLIC)


def sanitize_conflict_event(event: ConflictEvent, role: str) -> dict:
    """
    Sérialise un ConflictEvent en filtrant les champs selon le rôle.
    Champs RESTRICTED absents de la réponse pour les rôles inférieurs.
    """
    access = access_level_for_role(role)
    result: dict = {}

    # Champs PUBLIC — toujours présents
    result["source"]            = event.source
    result["event_date"]        = event.event_date.isoformat()
    result["event_type"]        = event.event_type
    result["province"]          = event.province
    result["severity"]          = event.severity
    result["displacement_risk"] = round(event.displacement_risk, 2)

    # Champs INTERNAL+
    if access >= DataClassification.INTERNAL:
        result["territoire"] = event.territoire
        result["p_code"]     = event.p_code

    # Champs RESTRICTED+
    if access >= DataClassification.RESTRICTED:
        if event.actors:
            result["actors"] = [_serialize_actor(a) for a in event.actors]
            result["_disclaimer"] = _DISCLAIMER
        result["coordinates"]   = event.coordinates
        result["fatalities"]    = event.fatalities_reported
        result["source_notes"]  = event.raw_notes

    return result


def _serialize_actor(a: ArmedActor) -> dict:
    from agents.conflit.data.armed_actors_rdc import ACTORS_BY_ACLED_NAME
    actor_ref = ACTORS_BY_ACLED_NAME.get(a.nom_acled or "")
    return {
        "nom":               a.nom_acled,
        "aliases":           a.nom_alternatifs,
        "categorie":         a.categorie,
        "role":              a.role,
        "provinces_actives": a.provinces_actives,
        "tendance":          a.tendance_activite,
        "type_violence":     a.type_violence_frequent,
        "source_fiabilite":  round(a.source_fiabilite, 2),
        "note_humanitaire":  actor_ref["note_humanitaire"] if actor_ref else None,
    }
