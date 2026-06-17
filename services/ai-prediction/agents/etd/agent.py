"""
AgentETD — Assistant intelligent des Entités Territoriales Décentralisées.

Sert les Villes, Communes, Secteurs et Chefferies (les seules entités dotées
de la personnalité juridique et de l'autonomie de gestion selon la Constitution).

Rôle : être le "chef de cabinet numérique" du Maire, du Bourgmestre, du Chef
de secteur ou de chefferie. Transforme les données brutes du terrain en
information structurée et actionnable, détecte les anomalies, identifie les
besoins prioritaires, génère automatiquement les rapports pour la province.

C'est l'agent qui fait le PONT entre le terrain (villages, quartiers)
et le niveau provincial.

Niveau hiérarchique: 6 (ETD) dans la chaîne 1=central, 2=province, 6=ETD,
                     8=groupement, 10=village
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import text

from db import engine

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

NIVEAU_ETD      = 6
NIVEAU_PROVINCE = 2
NIVEAU_CENTRAL  = 1

# Poids des types de sinistres pour le calcul de priorité
POIDS_TYPE_BESOIN: dict[str, float] = {
    "EAU":          1.0,   # vital
    "NOURRITURE":   1.0,   # vital
    "SANTE":        0.95,  # vital
    "ABRI":         0.85,  # urgent
    "MEDICAMENTS":  0.85,  # urgent
    "EDUCATION":    0.50,  # important
    "SOUTIEN":      0.40,  # important
    "AUTRE":        0.30,
}

# Seuils d'alerte (déclenchent la remontée automatique vers la province)
SEUILS_ALERTE: dict[str, float] = {
    "ratio_evenements_severes":   0.30,  # 30 % des événements sévérité ≥ 4
    "augmentation_24h":           0.50,  # +50 % d'événements en 24h
    "evenements_sans_localisation": 0.40, # 40 % d'événements sans localisation
    "deces_signales":             1.0,   # tout décès = alerte immédiate
}

LABELS_GRAVITE = {
    "ratio_evenements_severes":   "Proportion d'événements sévères",
    "augmentation_24h":           "Augmentation soudaine des événements (24h)",
    "evenements_sans_localisation": "Événements sans localisation précise",
    "deces_signales":             "Décès signalés",
}

LABELS_TYPE: dict[str, str] = {
    "INONDATION":      "Inondation",
    "GLISSEMENT":      "Glissement de terrain",
    "DEPLACEMENT":     "Déplacement de population",
    "EPIDEMIE":        "Épidémie",
    "CONFLIT":         "Conflit armé",
    "INCENDIE":        "Incendie",
    "SEISME":          "Séisme",
    "URGENCE_SANITAIRE": "Urgence sanitaire",
    "AUTRE":           "Autre",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _pcode_prefix(pcode: str) -> str:
    """Retourne un pattern LIKE pour filtrer toute la descendance d'un pcode."""
    return pcode.rstrip("%") + "%"


def _gravite_seuil(indicateur: str, valeur: float, seuil: float) -> str:
    ratio = valeur / max(seuil, 0.001)
    if indicateur == "deces_signales":
        return "CRITIQUE"
    if ratio >= 1.5:
        return "CRITIQUE"
    if ratio >= 1.0:
        return "ELEVEE"
    return "MOYENNE"


def _score_besoin(volume: int, urgence_max: float, type_besoin: str) -> float:
    poids = POIDS_TYPE_BESOIN.get(type_besoin.upper(), 0.3)
    return min(100.0, (volume ** 0.5) * urgence_max * poids * 10)


def _resume_executif(etd_pcode: str, analyse: dict, seuils: list[dict], besoins: list[dict]) -> str:
    nb = analyse.get("total_signalements", 0)
    tendance = analyse.get("tendance", {})
    pct = tendance.get("variation_pct", 0)
    alertes_critiques = [s for s in seuils if s["depasse"] and s["gravite"] == "CRITIQUE"]
    besoins_vitaux = [b for b in besoins if b["niveau"] == "VITAL"]

    parties = [f"L'ETD {etd_pcode} a enregistré {nb} événements sur les 7 derniers jours."]

    if pct >= 50:
        parties.append(f"Une hausse de {pct:.0f} % des signalements est observée.")
    elif pct <= -20:
        parties.append(f"Une baisse de {abs(pct):.0f} % des signalements est observée.")

    if alertes_critiques:
        parties.append(f"{len(alertes_critiques)} seuil(s) critique(s) dépassé(s).")

    if besoins_vitaux:
        types = ", ".join(b["type"] for b in besoins_vitaux[:3])
        parties.append(f"Besoins vitaux identifiés : {types}.")

    if any(s["depasse"] for s in seuils):
        parties.append("Une intervention du niveau provincial est recommandée.")
    else:
        parties.append("Situation sous contrôle — suivi rapproché conseillé.")

    return " ".join(parties)


# ---------------------------------------------------------------------------
# Agent ETD
# ---------------------------------------------------------------------------

class AgentETD:

    # ── 1. Analyse des signalements locaux ─────────────────────────────────

    async def analyser_signalements_locaux(self, etd_pcode: str, days: int = 7) -> dict:
        try:
            async with engine.connect() as conn:
                # Événements dans le périmètre de l'ETD
                q_total = await conn.execute(text("""
                    SELECT
                        hazard_type,
                        severity,
                        location_pcode,
                        status,
                        created_at
                    FROM disaster_events
                    WHERE location_pcode LIKE :prefix
                      AND created_at > NOW() - INTERVAL '1 day' * :days
                    ORDER BY created_at DESC
                    LIMIT 1000
                """), {"prefix": _pcode_prefix(etd_pcode), "days": days})
                rows = [dict(r._mapping) for r in q_total]

                # Trend : comparer la 1ère moitié vs la 2ème moitié de la période
                cutoff = _utcnow() - timedelta(days=days // 2)
                recent_half  = [r for r in rows if r["created_at"] and r["created_at"].replace(tzinfo=timezone.utc) >= cutoff]
                older_half   = [r for r in rows if r["created_at"] and r["created_at"].replace(tzinfo=timezone.utc) < cutoff]
                variation_pct = 0.0
                if older_half:
                    variation_pct = ((len(recent_half) - len(older_half)) / max(len(older_half), 1)) * 100

                # Regrouper par type
                par_type: dict[str, int] = defaultdict(int)
                for r in rows:
                    par_type[r.get("hazard_type") or "AUTRE"] += 1

                # Zones les plus touchées
                par_zone: dict[str, int] = defaultdict(int)
                for r in rows:
                    zone = r.get("location_pcode") or etd_pcode
                    par_zone[zone] += 1
                zones_critiques = sorted(
                    [{"pcode": k, "count": v} for k, v in par_zone.items()],
                    key=lambda x: -x["count"],
                )[:5]

                return {
                    "etd_pcode":          etd_pcode,
                    "periode_jours":      days,
                    "total_signalements": len(rows),
                    "par_type": [
                        {"type": t, "label": LABELS_TYPE.get(t, t), "count": c}
                        for t, c in sorted(par_type.items(), key=lambda x: -x[1])
                    ],
                    "tendance": {
                        "recent": len(recent_half),
                        "precedent": len(older_half),
                        "variation_pct": round(variation_pct, 1),
                        "sens": "HAUSSE" if variation_pct > 10 else ("BAISSE" if variation_pct < -10 else "STABLE"),
                    },
                    "zones_critiques": zones_critiques,
                    "generated_at": _utcnow().isoformat(),
                }

        except Exception as exc:
            logger.warning("etd_agent.analyser.error", etd=etd_pcode, error=str(exc))
            return {
                "etd_pcode":          etd_pcode,
                "periode_jours":      days,
                "total_signalements": 0,
                "par_type":           [],
                "tendance":           {"recent": 0, "precedent": 0, "variation_pct": 0.0, "sens": "STABLE"},
                "zones_critiques":    [],
                "generated_at":       _utcnow().isoformat(),
                "_source":            "fallback",
            }

    # ── 2. Vérification des incohérences ───────────────────────────────────

    async def verifier_incoherences(self, etd_pcode: str) -> list[dict]:
        incoherences: list[dict] = []
        try:
            async with engine.connect() as conn:
                # Événements sans localisation précise
                q_no_loc = await conn.execute(text("""
                    SELECT COUNT(*) AS cnt
                    FROM disaster_events
                    WHERE location_pcode LIKE :prefix
                      AND created_at > NOW() - INTERVAL '7 days'
                      AND (location_pcode IS NULL OR location_pcode = '')
                """), {"prefix": _pcode_prefix(etd_pcode)})
                row_no_loc = q_no_loc.fetchone()
                sans_geo = int((row_no_loc._mapping["cnt"] or 0)) if row_no_loc else 0
                if sans_geo > 0:
                    incoherences.append({
                        "type":        "LOCALISATION_MANQUANTE",
                        "gravite":     "FAIBLE",
                        "description": f"{sans_geo} événements sans localisation précise",
                        "suggestion":  "Demander aux agents terrain de préciser la localisation",
                    })

                # Bénéficiaires potentiellement en doublon (même p_code, statut pending)
                try:
                    q_dup = await conn.execute(text("""
                        SELECT COUNT(*) AS cnt
                        FROM beneficiaries
                        WHERE status = 'duplicate'
                          AND created_at > NOW() - INTERVAL '30 days'
                    """))
                    row_dup = q_dup.fetchone()
                    nb_dup = int((row_dup._mapping["cnt"] or 0)) if row_dup else 0
                    if nb_dup > 0:
                        incoherences.append({
                            "type":        "DOUBLON_BENEFICIAIRE",
                            "gravite":     "MOYENNE",
                            "description": f"{nb_dup} dossiers de bénéficiaires marqués en doublon",
                            "suggestion":  "Vérifier et fusionner les fiches dans le registre",
                        })
                except Exception:
                    pass

                # Événements bloqués en statut "reported" depuis > 48h
                q_stale = await conn.execute(text("""
                    SELECT COUNT(*) AS cnt
                    FROM disaster_events
                    WHERE location_pcode LIKE :prefix
                      AND status = 'reported'
                      AND created_at < NOW() - INTERVAL '48 hours'
                """), {"prefix": _pcode_prefix(etd_pcode)})
                row_stale = q_stale.fetchone()
                nb_stale = int((row_stale._mapping["cnt"] or 0)) if row_stale else 0
                if nb_stale > 0:
                    incoherences.append({
                        "type":        "SIGNALEMENT_EN_ATTENTE",
                        "gravite":     "MOYENNE",
                        "description": f"{nb_stale} événements en attente de validation depuis plus de 48h",
                        "suggestion":  "Relancer les validateurs locaux",
                    })

        except Exception as exc:
            logger.warning("etd_agent.incoherences.error", etd=etd_pcode, error=str(exc))

        return incoherences

    # ── 3. Identification des besoins prioritaires ─────────────────────────

    async def identifier_besoins_prioritaires(self, etd_pcode: str) -> list[dict]:
        besoins: list[dict[str, Any]] = []
        try:
            async with engine.connect() as conn:
                # Agréger les besoins depuis les bénéficiaires
                try:
                    q_ben = await conn.execute(text("""
                        SELECT
                            household_members,
                            vulnerability_level
                        FROM beneficiaries
                        WHERE status IN ('validated', 'under_validation', 'pending')
                          AND created_at > NOW() - INTERVAL '30 days'
                        LIMIT 2000
                    """))
                    ben_rows = [dict(r._mapping) for r in q_ben]

                    agg: dict[str, dict[str, Any]] = defaultdict(lambda: {
                        "menages": 0, "personnes": 0, "urgence_max": 0.0
                    })

                    for row in ben_rows:
                        hm = row.get("household_members") or []
                        if isinstance(hm, str):
                            import json
                            try:
                                hm = json.loads(hm)
                            except Exception:
                                hm = []
                        taille = len(hm) if isinstance(hm, list) else 1
                        vulne  = float(row.get("vulnerability_level") or 1)
                        # Inférer les besoins à partir du niveau de vulnérabilité
                        if vulne >= 4:
                            for t in ["EAU", "NOURRITURE", "SANTE"]:
                                agg[t]["menages"]   += 1
                                agg[t]["personnes"] += taille
                                agg[t]["urgence_max"] = max(agg[t]["urgence_max"], vulne / 5.0)
                        elif vulne >= 2:
                            for t in ["ABRI", "NOURRITURE"]:
                                agg[t]["menages"]   += 1
                                agg[t]["personnes"] += taille
                                agg[t]["urgence_max"] = max(agg[t]["urgence_max"], vulne / 5.0)

                    for type_b, data in agg.items():
                        score = _score_besoin(data["personnes"], data["urgence_max"], type_b)
                        besoins.append({
                            "type":               type_b,
                            "menages_concernes":  data["menages"],
                            "personnes_concernees": data["personnes"],
                            "score_priorite":     round(score, 1),
                            "niveau":             "VITAL" if score > 80 else ("URGENT" if score > 50 else "IMPORTANT"),
                        })
                    besoins.sort(key=lambda b: -b["score_priorite"])

                except Exception:
                    # Pas de table bénéficiaires → inférer depuis les événements
                    q_ev = await conn.execute(text("""
                        SELECT hazard_type, COUNT(*) AS cnt, MAX(severity) AS max_sev
                        FROM disaster_events
                        WHERE location_pcode LIKE :prefix
                          AND created_at > NOW() - INTERVAL '30 days'
                        GROUP BY hazard_type
                    """), {"prefix": _pcode_prefix(etd_pcode)})
                    for row in q_ev:
                        d = dict(row._mapping)
                        ht = d.get("hazard_type") or "AUTRE"
                        cnt = int(d.get("cnt") or 0)
                        sev = float(d.get("max_sev") or 1) / 5.0
                        type_b = "SANTE" if ht == "EPIDEMIE" else ("ABRI" if ht in ("INONDATION", "GLISSEMENT") else "AUTRE")
                        score = _score_besoin(cnt * 4, sev, type_b)
                        besoins.append({
                            "type":               type_b,
                            "menages_concernes":  cnt,
                            "personnes_concernees": cnt * 4,
                            "score_priorite":     round(score, 1),
                            "niveau":             "VITAL" if score > 80 else ("URGENT" if score > 50 else "IMPORTANT"),
                        })
                    besoins.sort(key=lambda b: -b["score_priorite"])

        except Exception as exc:
            logger.warning("etd_agent.besoins.error", etd=etd_pcode, error=str(exc))

        return besoins[:8]

    # ── 4. Vérification des seuils d'alerte ────────────────────────────────

    async def verifier_seuils(self, etd_pcode: str) -> list[dict]:
        seuils_result: list[dict] = []
        try:
            async with engine.connect() as conn:
                # Métriques de base
                q = await conn.execute(text("""
                    SELECT
                        COUNT(*)                                           AS total_7j,
                        COUNT(*) FILTER (WHERE severity >= 4)             AS severes_7j,
                        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h,
                        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '48 hours'
                                           AND created_at <= NOW() - INTERVAL '24 hours') AS prev_24h,
                        COUNT(*) FILTER (WHERE location_pcode IS NULL OR location_pcode = '') AS sans_loc
                    FROM disaster_events
                    WHERE location_pcode LIKE :prefix
                      AND created_at > NOW() - INTERVAL '7 days'
                """), {"prefix": _pcode_prefix(etd_pcode)})
                row = q.fetchone()

                if row:
                    d         = dict(row._mapping)
                    total_7j  = max(int(d.get("total_7j")  or 0), 1)
                    severes   = int(d.get("severes_7j") or 0)
                    last_24h  = int(d.get("last_24h")   or 0)
                    prev_24h  = max(int(d.get("prev_24h")  or 0), 1)
                    sans_loc  = int(d.get("sans_loc")   or 0)

                    metrics = {
                        "ratio_evenements_severes":       severes / total_7j,
                        "augmentation_24h":               (last_24h - prev_24h) / prev_24h,
                        "evenements_sans_localisation":   sans_loc / total_7j,
                        "deces_signales":                 0.0,
                    }

                    for indicateur, seuil in SEUILS_ALERTE.items():
                        valeur  = metrics.get(indicateur, 0.0)
                        depasse = valeur >= seuil
                        seuils_result.append({
                            "indicateur":     indicateur,
                            "label":          LABELS_GRAVITE.get(indicateur, indicateur),
                            "valeur_actuelle": round(valeur, 3),
                            "seuil":          seuil,
                            "depasse":        depasse,
                            "gravite":        _gravite_seuil(indicateur, valeur, seuil) if depasse else None,
                            "action":         "REMONTER_PROVINCE" if depasse else None,
                        })

        except Exception as exc:
            logger.warning("etd_agent.seuils.error", etd=etd_pcode, error=str(exc))

        return seuils_result

    # ── 5. Rapport province (agrégation complète) ──────────────────────────

    async def produire_rapport_province(self, etd_pcode: str) -> dict:
        analyse    = await self.analyser_signalements_locaux(etd_pcode, days=7)
        besoins    = await self.identifier_besoins_prioritaires(etd_pcode)
        incoherences = await self.verifier_incoherences(etd_pcode)
        seuils     = await self.verifier_seuils(etd_pcode)

        resume = _resume_executif(etd_pcode, analyse, seuils, besoins)
        nb_depasses = sum(1 for s in seuils if s["depasse"])

        return {
            "etd_pcode":              etd_pcode,
            "date_rapport":           _utcnow().isoformat(),
            "resume_executif":        resume,
            "total_signalements":     analyse.get("total_signalements", 0),
            "tendance":               analyse.get("tendance", {}),
            "par_type":               analyse.get("par_type", [])[:5],
            "besoins_prioritaires":   besoins[:5],
            "incoherences":           incoherences,
            "seuils_depasses":        [s for s in seuils if s["depasse"]],
            "nb_seuils_depasses":     nb_depasses,
            "recommandation":         "INTERVENTION_PROVINCIALE" if nb_depasses >= 2 else (
                                      "SURVEILLANCE_RENFORCEE"  if nb_depasses == 1 else "SUIVI_NORMAL"),
            "destinataire":           "PROVINCE",
        }

    # ── 6. Métriques du flux bidirectionnel ───────────────────────────────

    async def metriques_flux(self, etd_pcode: str | None = None) -> dict:
        try:
            async with engine.connect() as conn:
                where_clause = "WHERE fm.created_at > NOW() - INTERVAL '30 days'"
                params: dict[str, Any] = {}
                if etd_pcode:
                    where_clause += " AND (fm.entite_origine_pcode = :pcode OR fm.entite_destination_pcode = :pcode)"
                    params["pcode"] = etd_pcode

                q = await conn.execute(text(f"""
                    SELECT
                        COUNT(*) FILTER (WHERE direction = 'ASCENDANT')  AS total_ascendant,
                        COUNT(*) FILTER (WHERE direction = 'DESCENDANT') AS total_descendant,
                        COUNT(*) FILTER (WHERE statut = 'EXECUTE')       AS total_executes,
                        COUNT(*) FILTER (WHERE statut NOT IN ('EXECUTE') AND created_at < NOW() - INTERVAL '24 hours') AS en_attente_24h,
                        AVG(EXTRACT(EPOCH FROM (accuse_reception_le - created_at))/3600)
                            FILTER (WHERE accuse_reception_le IS NOT NULL) AS delai_moy_accuse_h,
                        AVG(EXTRACT(EPOCH FROM (execute_le - created_at))/3600)
                            FILTER (WHERE execute_le IS NOT NULL)          AS delai_moy_exec_h
                    FROM flux_message fm
                    {where_clause}
                """), params)
                row = q.fetchone()
                if row:
                    d = dict(row._mapping)
                    total_e = int(d.get("total_executes") or 0)
                    total_a = int(d.get("total_ascendant") or 0)
                    total_d = int(d.get("total_descendant") or 0)
                    total   = max(total_a + total_d, 1)
                    return {
                        "total_ascendant":    total_a,
                        "total_descendant":   total_d,
                        "taux_execution":     round(total_e / total * 100, 1),
                        "en_attente_24h":     int(d.get("en_attente_24h") or 0),
                        "delai_moyen_accuse_h": round(float(d.get("delai_moy_accuse_h") or 0), 1),
                        "delai_moyen_exec_h": round(float(d.get("delai_moy_exec_h") or 0), 1),
                        "generated_at":       _utcnow().isoformat(),
                    }
        except Exception as exc:
            logger.warning("etd_agent.metriques.error", error=str(exc))

        return {
            "total_ascendant": 0, "total_descendant": 0, "taux_execution": 0.0,
            "en_attente_24h": 0, "delai_moyen_accuse_h": 0.0, "delai_moyen_exec_h": 0.0,
            "generated_at": _utcnow().isoformat(), "_source": "fallback",
        }


# Singleton — instancié au démarrage du service
etd_agent = AgentETD()
