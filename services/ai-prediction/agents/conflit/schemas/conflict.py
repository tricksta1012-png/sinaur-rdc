from __future__ import annotations

from datetime import datetime
from enum import IntEnum

from pydantic import BaseModel


class DataClassification(IntEnum):
    """Niveaux d'accès croissants — utilisés pour la comparaison >= dans le sanitizer."""
    PUBLIC       = 1   # portail public, tous utilisateurs
    INTERNAL     = 2   # agents connectés, coordinateurs locaux
    RESTRICTED   = 3   # coordinateurs nationaux, décideurs, partenaires accrédités
    CONFIDENTIAL = 4   # décideurs nationaux uniquement

    def label(self) -> str:
        return self.name


class ActorRole(str):
    INITIATEUR  = "INITIATEUR"
    CIBLE       = "CIBLE"
    INTERVENANT = "INTERVENANT"


class ArmedActor(BaseModel):
    # Champ PUBLIC — jamais de nom propre
    categorie: str
    zone_operation: str

    # Champs RESTRICTED — nom réel depuis ACLED
    nom_acled: str | None = None
    nom_alternatifs: list[str] = []
    role: str = ActorRole.INITIATEUR
    source_fiabilite: float = 0.70

    # Champs RESTRICTED — historique opérationnel
    provinces_actives: list[str] = []
    type_violence_frequent: str = "Inconnu"
    nb_evenements_acled_1an: int = 0
    tendance_activite: str = "STABLE"

    classification: DataClassification = DataClassification.RESTRICTED


class ConflictEvent(BaseModel):
    # --- Champs PUBLIC ---
    source: str
    external_id: str
    event_date: datetime
    event_type: str
    province: str
    severity: int                     # 1-5
    displacement_risk: float          # 0.0-1.0
    classification_globale: DataClassification = DataClassification.RESTRICTED

    # --- Champs INTERNAL ---
    territoire: str | None = None
    p_code: str | None = None

    # --- Champs RESTRICTED ---
    actors: list[ArmedActor] | None = None
    coordinates: tuple[float, float] | None = None
    fatalities_reported: int | None = None
    raw_notes: str | None = None
    source_url: str | None = None
