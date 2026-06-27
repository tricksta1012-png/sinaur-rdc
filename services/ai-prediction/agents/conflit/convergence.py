"""
Détection de convergence VIEWS × terrain.

VIEWS dit "risque élevé dans 1-3 mois" ET les incidents terrain confirment
"ça commence maintenant" → convergence = alerte renforcée.

Logique :
  1. Pour chaque province ayant une prévision VIEWS (probabilite ≥ SEUIL_VIEWS)
     dans les 3 prochains mois,
  2. Compter les incidents terrain des 7 derniers jours (conflict_event_raw
     + intel_events).
  3. Si incidents récents ≥ SEUIL_TERRAIN → CONVERGENCE_CRITIQUE.
  4. Si VIEWS élevé sans signal terrain récent → VIGILANCE.
  5. Publier sur le bus conflit.convergence pour alertes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

import structlog

logger = structlog.get_logger(__name__)

SEUIL_VIEWS    = 0.40   # probabilité VIEWS minimum pour déclencher la surveillance
SEUIL_CRITIQUE = 0.60   # probabilité au-dessus de laquelle c'est critique même sans terrain
SEUIL_TERRAIN  = 2      # incidents récents (7j) pour confirmer le signal

NiveauConvergence = Literal["CONVERGENCE_CRITIQUE", "ALERTE_RENFORCEE", "VIGILANCE", "NORMAL"]


async def detecter_convergences() -> list[dict]:
    """
    Détecte les zones de convergence VIEWS + terrain en temps réel.
    Retourne la liste des alertes de convergence triées par niveau.
    """
    try:
        from db import engine
    except Exception as exc:
        logger.warning("convergence.db_unavailable", error=str(exc))
        return []

    now = datetime.now(timezone.utc)
    cutoff_terrain = now - timedelta(days=7)
    horizon_max = now.date().replace(day=1)
    from datetime import date
    # mois cible ≤ 3 mois à venir
    if horizon_max.month <= 9:
        horizon_limite = date(horizon_max.year, horizon_max.month + 3, 1)
    else:
        horizon_limite = date(horizon_max.year + 1, (horizon_max.month + 3) % 12 or 12, 1)

    async with engine.connect() as conn:
        from sqlalchemy import text

        # 1. Prévisions VIEWS à risque élevé dans les 3 prochains mois
        views_rows = await conn.execute(text("""
            SELECT
                province_pcode,
                pred_pcode,
                province_nom,
                MIN(mois_cible)               AS prochain_mois,
                ROUND(MAX(probabilite)::numeric, 3) AS probabilite_max,
                ROUND(SUM(morts_predites)::numeric, 1) AS morts_predites_total
            FROM prevision_conflit
            WHERE source = 'VIEWS'
              AND mois_cible >= CURRENT_DATE
              AND mois_cible < :horizon_limite
              AND probabilite >= :seuil
            GROUP BY province_pcode, pred_pcode, province_nom
            ORDER BY probabilite_max DESC
        """), {"horizon_limite": horizon_limite, "seuil": SEUIL_VIEWS})
        previsions = views_rows.fetchall()

        if not previsions:
            return []

        # 2. Incidents terrain 7 derniers jours par province (conflict_event_raw)
        terrain_rows = await conn.execute(text("""
            SELECT
                p_code,
                province,
                COUNT(*) AS nb_incidents,
                MAX(severity) AS severity_max
            FROM conflict_event_raw
            WHERE event_date >= :cutoff
              AND event_type NOT IN ('displacement', 'humanitarian')
            GROUP BY p_code, province
        """), {"cutoff": cutoff_terrain})
        terrain_map: dict[str, dict] = {}
        for r in terrain_rows.fetchall():
            if r.p_code:
                terrain_map[r.p_code] = {"nb": int(r.nb_incidents), "severity_max": int(r.severity_max or 1)}
            # Fallback par nom de province (si p_code NULL)
            if r.province:
                terrain_map.setdefault(r.province.lower(), {"nb": int(r.nb_incidents), "severity_max": int(r.severity_max or 1)})

        # 3. Incidents terrain via intel_events (renseignement) — complément
        intel_rows = await conn.execute(text("""
            SELECT
                p_code,
                province,
                COUNT(*) AS nb_events
            FROM intel_events
            WHERE date >= :cutoff
              AND category IN ('COMBAT', 'ATTENTAT', 'DEPLACEMENT', 'EXACTION', 'AUTRE')
            GROUP BY p_code, province
        """), {"cutoff": cutoff_terrain})
        for r in intel_rows.fetchall():
            key = r.p_code or (r.province or "").lower()
            if key:
                existing = terrain_map.get(key, {"nb": 0, "severity_max": 1})
                terrain_map[key] = {
                    "nb": existing["nb"] + int(r.nb_events),
                    "severity_max": existing["severity_max"],
                }

    # 4. Calculer le niveau de convergence pour chaque province VIEWS à risque
    resultats: list[dict] = []
    for row in previsions:
        p_code     = row.province_pcode   # COD-AB
        pred_code  = row.pred_pcode        # CD-NK style
        province   = row.province_nom or p_code or ""
        prob       = float(row.probabilite_max or 0)
        morts_pred = float(row.morts_predites_total or 0)
        mois       = str(row.prochain_mois)

        # Chercher les incidents terrain (COD-AB ou pred_code ou nom)
        t = (
            terrain_map.get(p_code)
            or terrain_map.get(pred_code or "")
            or terrain_map.get(province.lower())
            or {"nb": 0, "severity_max": 1}
        )
        nb_incidents = t["nb"]
        severity_max = t["severity_max"]

        # Calcul du niveau
        if prob >= SEUIL_CRITIQUE and nb_incidents >= SEUIL_TERRAIN:
            niveau: NiveauConvergence = "CONVERGENCE_CRITIQUE"
            score_convergence = min(100, int(prob * 80 + nb_incidents * 5 + severity_max * 5))
        elif prob >= SEUIL_VIEWS and nb_incidents >= SEUIL_TERRAIN:
            niveau = "ALERTE_RENFORCEE"
            score_convergence = min(80, int(prob * 60 + nb_incidents * 4))
        elif prob >= SEUIL_CRITIQUE:
            niveau = "VIGILANCE"
            score_convergence = int(prob * 50)
        else:
            continue  # NORMAL — ne pas inclure dans les alertes

        message = _message(niveau, province, prob, nb_incidents, mois, morts_pred)

        resultats.append({
            "province_pcode":    p_code,
            "pred_pcode":        pred_code,
            "province":          province,
            "niveau":            niveau,
            "score_convergence": score_convergence,
            "views_probabilite": prob,
            "views_mois_cible":  mois,
            "views_morts_pred":  morts_pred,
            "terrain_incidents_7j": nb_incidents,
            "terrain_severity_max": severity_max,
            "message":           message,
            "calcule_le":        now.isoformat(),
        })

    # Trier par score décroissant
    resultats.sort(key=lambda x: x["score_convergence"], reverse=True)
    logger.info("convergence.detected", total=len(resultats),
                critiques=sum(1 for r in resultats if r["niveau"] == "CONVERGENCE_CRITIQUE"))
    return resultats


def _message(
    niveau: NiveauConvergence,
    province: str,
    prob: float,
    nb_incidents: int,
    mois: str,
    morts_pred: float,
) -> str:
    pct = int(prob * 100)
    if niveau == "CONVERGENCE_CRITIQUE":
        return (
            f"CONVERGENCE CRITIQUE en {province} : VIEWS prédit {pct}% de risque conflit "
            f"({mois}) ET {nb_incidents} incident(s) terrain ces 7 derniers jours confirment "
            f"l'escalade. Vigilance maximale."
        )
    elif niveau == "ALERTE_RENFORCEE":
        return (
            f"Alerte renforcée en {province} : VIEWS prédit {pct}% de risque ({mois}), "
            f"{nb_incidents} incident(s) terrain récents. Les deux signaux convergent."
        )
    else:  # VIGILANCE
        return (
            f"Vigilance en {province} : VIEWS prédit {pct}% de risque ({mois}), "
            f"pas d'incidents terrain récents. Signal macro sans confirmation locale."
        )
