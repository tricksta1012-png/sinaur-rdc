"""
Auto-évaluation a posteriori des prévisions VIEWS.

Principe (inspiré de VIEWS) : comparer ce qui était prédit à ce qui s'est
réellement passé, puis publier le taux de réussite en toute transparence.

Méthode d'évaluation — binaire directionnelle :
  - Prévision "conflit attendu"   : probabilite_max > SEUIL_CONFLIT
  - Prévision "calme attendu"     : probabilite_max ≤ SEUIL_CONFLIT
  - Correcte si la direction est bonne (conflit prédit ET conflit observé,
    ou calme prédit ET calme observé).

Source des incidents réels : conflict_event_raw (province + p_code + event_date).
Agrégation au niveau province × mois pour correspondre aux grilles VIEWS.
"""
from __future__ import annotations

import structlog
from datetime import date, datetime, timezone
from sqlalchemy import text

logger = structlog.get_logger(__name__)

# Seuil de probabilité au-dessus duquel on considère que VIEWS prédisait un conflit
SEUIL_CONFLIT = 0.30

# Nombre minimum d'incidents réels pour qualifier le mois de "conflit observé"
SEUIL_INCIDENTS = 1

METHODE = f"binary_directional_p{int(SEUIL_CONFLIT*100)}_i{SEUIL_INCIDENTS}"


async def evaluer_previsions_echeues() -> int:
    """
    Évalue toutes les prévisions VIEWS dont le mois cible est passé et non évaluées.
    Retourne le nombre de prévisions évaluées.
    """
    try:
        from db import engine
    except Exception as exc:
        logger.warning("auto_eval.db_unavailable", error=str(exc))
        return 0

    evaluated = 0
    today = date.today()

    async with engine.begin() as conn:
        # Prévisions échues non évaluées — agrégées par (province, mois_cible)
        rows = await conn.execute(text("""
            SELECT
                province_pcode,
                pred_pcode,
                province_nom,
                mois_cible,
                ROUND(MAX(probabilite)::numeric, 4) AS probabilite_max,
                ROUND(AVG(probabilite)::numeric, 4) AS probabilite_moy,
                ROUND(SUM(morts_predites)::numeric, 1) AS morts_predites_total
            FROM prevision_conflit
            WHERE source = 'VIEWS'
              AND evaluee = false
              AND mois_cible < :today
              AND province_pcode IS NOT NULL
            GROUP BY province_pcode, pred_pcode, province_nom, mois_cible
            ORDER BY mois_cible ASC
        """), {"today": today})
        previsions = rows.fetchall()

    if not previsions:
        logger.info("auto_eval.nothing_to_evaluate")
        return 0

    logger.info("auto_eval.start", count=len(previsions))

    async with engine.begin() as conn:
        for row in previsions:
            province_pcode  = row.province_pcode
            pred_pcode      = row.pred_pcode
            province_nom    = row.province_nom
            mois_cible      = row.mois_cible        # date Python
            probabilite_max = float(row.probabilite_max or 0)
            morts_predites  = float(row.morts_predites_total or 0)

            # ── Incidents réels ce mois-là dans cette province ────────────────
            debut_mois = datetime(mois_cible.year, mois_cible.month, 1, tzinfo=timezone.utc)
            if mois_cible.month == 12:
                fin_mois = datetime(mois_cible.year + 1, 1, 1, tzinfo=timezone.utc)
            else:
                fin_mois = datetime(mois_cible.year, mois_cible.month + 1, 1, tzinfo=timezone.utc)

            # Cherche en priorité par COD-AB p_code, fallback sur province_nom
            reel_row = await conn.execute(text("""
                SELECT
                    COUNT(*)                   AS nb_incidents,
                    COALESCE(SUM(COALESCE(fatalities_high, fatalities_low, 0)), 0) AS morts_reels
                FROM conflict_event_raw
                WHERE event_date >= :debut AND event_date < :fin
                  AND (
                        p_code = :pcode
                        OR (p_code IS NULL AND LOWER(province) = LOWER(:province_nom))
                      )
                  AND event_type NOT IN ('displacement', 'humanitarian')
            """), {
                "debut":       debut_mois,
                "fin":         fin_mois,
                "pcode":       province_pcode,
                "province_nom": province_nom or "",
            })
            reel = reel_row.fetchone()
            incidents_reels = int(reel.nb_incidents or 0)
            morts_reels     = float(reel.morts_reels or 0)

            # ── Évaluation binaire directionnelle ────────────────────────────
            conflit_predit  = probabilite_max > SEUIL_CONFLIT
            conflit_observe = incidents_reels >= SEUIL_INCIDENTS
            prediction_correcte = (conflit_predit == conflit_observe)

            erreur_absolue = abs(morts_predites - morts_reels)

            # ── Insérer dans evaluation_prediction ───────────────────────────
            await conn.execute(text("""
                INSERT INTO evaluation_prediction
                    (prevision_source, province_pcode, pred_pcode,
                     mois_cible, morts_predites, morts_reels,
                     incidents_reels, erreur_absolue,
                     prediction_correcte, methode_evaluation)
                VALUES
                    ('VIEWS', :province_pcode, :pred_pcode,
                     :mois_cible, :morts_predites, :morts_reels,
                     :incidents_reels, :erreur_absolue,
                     :prediction_correcte, :methode)
                ON CONFLICT DO NOTHING
            """), {
                "province_pcode":     province_pcode,
                "pred_pcode":         pred_pcode,
                "mois_cible":         mois_cible,
                "morts_predites":     morts_predites,
                "morts_reels":        morts_reels,
                "incidents_reels":    incidents_reels,
                "erreur_absolue":     erreur_absolue,
                "prediction_correcte": prediction_correcte,
                "methode":            METHODE,
            })

            # ── Marquer les prévisions de ce (province, mois) comme évaluées ─
            await conn.execute(text("""
                UPDATE prevision_conflit
                SET evaluee = true
                WHERE source = 'VIEWS'
                  AND province_pcode = :pcode
                  AND mois_cible = :mois
            """), {"pcode": province_pcode, "mois": mois_cible})

            evaluated += 1
            logger.info(
                "auto_eval.evaluated",
                province=province_nom,
                mois=str(mois_cible),
                prob=round(probabilite_max, 3),
                incidents=incidents_reels,
                correct=prediction_correcte,
            )

    logger.info("auto_eval.done", evaluated=evaluated)
    return evaluated


async def taux_reussite(province_pcode: str | None = None) -> dict:
    """
    Calcule le taux de réussite global (ou par province) des prévisions VIEWS.
    Retourne un dict prêt pour la sérialisation JSON.
    """
    try:
        from db import engine
    except Exception:
        return _empty_taux()

    async with engine.connect() as conn:
        # Taux global
        global_row = await conn.execute(text("""
            SELECT
                COUNT(*)  AS total,
                SUM(CASE WHEN prediction_correcte THEN 1 ELSE 0 END) AS correctes,
                ROUND(AVG(CASE WHEN prediction_correcte THEN 1.0 ELSE 0.0 END)::numeric * 100, 1) AS taux_pct,
                ROUND(AVG(erreur_absolue)::numeric, 1) AS erreur_moy,
                MIN(mois_cible) AS premier_mois,
                MAX(mois_cible) AS dernier_mois
            FROM evaluation_prediction
            WHERE prevision_source = 'VIEWS'
              AND (:pcode IS NULL OR province_pcode = :pcode)
        """), {"pcode": province_pcode})
        g = global_row.fetchone()

        # Détail par province (si pas de filtre)
        provinces = []
        if province_pcode is None:
            prov_rows = await conn.execute(text("""
                SELECT
                    province_pcode, pred_pcode,
                    COUNT(*) AS total,
                    SUM(CASE WHEN prediction_correcte THEN 1 ELSE 0 END) AS correctes,
                    ROUND(AVG(CASE WHEN prediction_correcte THEN 1.0 ELSE 0.0 END)::numeric * 100, 1) AS taux_pct,
                    ROUND(AVG(erreur_absolue)::numeric, 1) AS erreur_moy
                FROM evaluation_prediction
                WHERE prevision_source = 'VIEWS'
                GROUP BY province_pcode, pred_pcode
                ORDER BY taux_pct DESC
            """))
            for r in prov_rows.fetchall():
                provinces.append({
                    "province_pcode": r.province_pcode,
                    "pred_pcode":     r.pred_pcode,
                    "total":          int(r.total or 0),
                    "correctes":      int(r.correctes or 0),
                    "taux_pct":       float(r.taux_pct or 0),
                    "erreur_moy":     float(r.erreur_moy or 0),
                })

    total = int(g.total or 0)
    return {
        "source":          "VIEWS",
        "methode":         METHODE,
        "seuil_conflit":   SEUIL_CONFLIT,
        "seuil_incidents": SEUIL_INCIDENTS,
        "total_evaluees":  total,
        "correctes":       int(g.correctes or 0),
        "taux_pct":        float(g.taux_pct or 0) if total > 0 else None,
        "erreur_moy":      float(g.erreur_moy or 0) if total > 0 else None,
        "premier_mois":    str(g.premier_mois) if g.premier_mois else None,
        "dernier_mois":    str(g.dernier_mois) if g.dernier_mois else None,
        "par_province":    provinces,
        "note": (
            "L'auto-évaluation commence dès que les premiers mois cibles sont passés. "
            f"Méthode : {METHODE} — direction correcte si prob>{SEUIL_CONFLIT} ↔ incidents≥{SEUIL_INCIDENTS}."
            if total == 0 else None
        ),
    }


def _empty_taux() -> dict:
    return {
        "source": "VIEWS", "total_evaluees": 0, "correctes": 0,
        "taux_pct": None, "erreur_moy": None,
        "premier_mois": None, "dernier_mois": None, "par_province": [],
    }
