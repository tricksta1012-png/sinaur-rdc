"""Province-level threat assessment from intel events."""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timezone
import structlog
from ..schemas import IntelCategory, IntelEvent, ProvinceAssessment, ThreatLevel

logger = structlog.get_logger(__name__)

PCODE_NAMES = {
    "CD10": "Kinshasa", "CD20": "Kongo-Central", "CD21": "Kwango",
    "CD22": "Kwilu", "CD23": "Maï-Ndombe", "CD41": "Équateur",
    "CD42": "Sud-Ubangi", "CD43": "Nord-Ubangi", "CD44": "Mongala",
    "CD45": "Tshuapa", "CD51": "Tshopo", "CD52": "Bas-Uélé",
    "CD53": "Haut-Uélé", "CD54": "Ituri", "CD61": "Nord-Kivu",
    "CD62": "Sud-Kivu", "CD63": "Maniema", "CD71": "Haut-Katanga",
    "CD72": "Lualaba", "CD73": "Haut-Lomami", "CD74": "Tanganyika",
    "CD81": "Lomami", "CD82": "Kasaï-Oriental", "CD83": "Kasaï",
    "CD84": "Kasaï-Central", "CD85": "Sankuru",
}

THREAT_META = {
    ThreatLevel.STABLE:    ("STABLE",    "Situation calme, opérations normales possibles"),
    ThreatLevel.VIGILANCE: ("VIGILANCE", "Tensions ponctuelles, surveillance renforcée"),
    ThreatLevel.ELEVE:     ("ÉLEVÉ",     "Activité armée active, précautions nécessaires"),
    ThreatLevel.SEVERE:    ("SÉVÈRE",    "Combats actifs, accès humanitaire restreint"),
    ThreatLevel.CRITIQUE:  ("CRITIQUE",  "Combats intenses, accès humanitaire impossible"),
}

ACCESS_LABELS = {
    ThreatLevel.STABLE:    "Libre — opérations terrain sans restriction",
    ThreatLevel.VIGILANCE: "Prudence — coordination préalable recommandée",
    ThreatLevel.ELEVE:     "Restreint — déplacement en convoi uniquement",
    ThreatLevel.SEVERE:    "Très restreint — approbation UNDSS requise",
    ThreatLevel.CRITIQUE:  "Impossible — évacuation du personnel recommandée",
}

ACTIONS = {
    ThreatLevel.STABLE:    ["Opérations normales", "Missions terrain sans escorte possibles"],
    ThreatLevel.VIGILANCE: ["Informer les autorités locales avant déplacement", "Éviter les zones signalées"],
    ThreatLevel.ELEVE:     ["Déplacement en convoi uniquement", "Coordination MONUSCO avant mission", "Plan d'évacuation activé"],
    ThreatLevel.SEVERE:    ["Suspension missions non essentielles", "Personnel national uniquement en zone", "Prépositionner les ressources"],
    ThreatLevel.CRITIQUE:  ["Évacuation personnel international", "Activer protocole d'urgence", "Communication radio sécurisée exclusivement"],
}


def _score_to_level(score: float) -> ThreatLevel:
    if score >= 80: return ThreatLevel.CRITIQUE
    if score >= 60: return ThreatLevel.SEVERE
    if score >= 40: return ThreatLevel.ELEVE
    if score >= 20: return ThreatLevel.VIGILANCE
    return ThreatLevel.STABLE


def assess_provinces(events: list[IntelEvent]) -> list[ProvinceAssessment]:
    by_pcode: dict[str, list[IntelEvent]] = defaultdict(list)
    for e in events:
        key = e.p_code or "UNKNOWN"
        by_pcode[key].append(e)

    assessments: list[ProvinceAssessment] = []
    now = datetime.now(timezone.utc).isoformat()

    for p_code, evs in by_pcode.items():
        if p_code == "UNKNOWN":
            continue

        military_count = sum(1 for e in evs if e.category == IntelCategory.ACTIVITE_MILITAIRE)
        incident_count = sum(1 for e in evs if e.category == IntelCategory.INCIDENT_SECURITAIRE)
        total = len(evs)

        score = min(100.0, military_count * 12 + incident_count * 8 + total * 2)
        level = _score_to_level(score)
        label, justif = THREAT_META[level]

        actors = list({a for e in evs for a in e.actor_names})
        sources = list({e.source_id for e in evs})
        confidence = min(0.95, 0.45 + total * 0.04)

        assessments.append(ProvinceAssessment(
            province=PCODE_NAMES.get(p_code, p_code),
            p_code=p_code,
            threat_level=level,
            threat_label=label,
            justification=justif,
            humanitarian_access=ACCESS_LABELS[level],
            recommended_actions=ACTIONS[level],
            safe_corridors=[],
            active_actors=actors[:5],
            sources=sources,
            confidence=round(confidence, 2),
            computed_at=now,
        ))

    return sorted(assessments, key=lambda a: a.threat_level, reverse=True)
