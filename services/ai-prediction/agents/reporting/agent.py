"""
ReportingAgent — génère bulletins opérationnels, résumés exécutifs et exports HXL.

Rapports automatiques via APScheduler :
  - Bulletin quotidien à 06h00 (Africa/Kinshasa)
  - Résumé exécutif hebdomadaire le lundi à 08h00
  - Rapport provincial sur demande

Les exports HXL sont anonymisés (agrégation par P-code uniquement).
Jamais de nom, téléphone ou identifiant individuel dans les exports.
"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Any

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Tags HXL standard (humanitaire)
# ---------------------------------------------------------------------------

HXL_TAGS: dict[str, str] = {
    "province": "#adm1+name",
    "pcode": "#adm1+code",
    "hazard_type": "#event+type",
    "affected_count": "#affected+individuals",
    "start_date": "#date+start",
    "severity": "#severity",
    "source": "#meta+source",
    "status": "#status",
}

# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

_REPORTS_STORE: list[dict[str, Any]] = []  # max 100 rapports
_MAX_REPORTS = 100

# Dernier export HXL (CSV string)
_LATEST_HXL: str = ""

# Historique des exports HXL
_HXL_HISTORY: list[dict[str, Any]] = []


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class ReportingAgent:
    """
    Génère et stocke les rapports opérationnels SINAUR-RDC.

    Rapports automatiques planifiés avec APScheduler.
    Exports HXL anonymisés conformes au standard humanitaire.
    """

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone="Africa/Kinshasa")

    async def start(self) -> None:
        """Enregistre les jobs planifiés et démarre le scheduler."""
        # Bulletin quotidien à 06h00 Africa/Kinshasa
        self._scheduler.add_job(
            self.generate_daily_bulletin,
            "cron",
            hour=6,
            minute=0,
            id="reporting_daily_bulletin",
            name="ReportingAgent:daily_bulletin",
            misfire_grace_time=3600,
            coalesce=True,
        )

        # Résumé exécutif hebdomadaire — lundi à 08h00
        self._scheduler.add_job(
            self.generate_weekly_summary,
            "cron",
            day_of_week="mon",
            hour=8,
            minute=0,
            id="reporting_weekly_summary",
            name="ReportingAgent:weekly_summary",
            misfire_grace_time=3600,
            coalesce=True,
        )

        self._scheduler.start()
        logger.info(
            "reporting_agent.started",
            jobs=["daily_bulletin@06:00", "weekly_summary@mon_08:00"],
        )

    async def stop(self) -> None:
        """Arrête le scheduler gracieusement."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("reporting_agent.stopped")

    # -----------------------------------------------------------------------
    # Génération de rapports
    # -----------------------------------------------------------------------

    async def generate_daily_bulletin(self) -> dict[str, Any]:
        """
        Génère le bulletin opérationnel quotidien.

        Contenu :
          - Alertes actives par province
          - Nouveaux signalements (24h)
          - Stocks critiques
          - Distributions (24h)
          - Anomalies détectées
          - Risques à 7 jours

        Tire les données depuis la DB (si disponible) et les stores mémoire
        des autres agents.
        """
        generated_at = datetime.now(timezone.utc)
        report_id = f"daily_{generated_at.strftime('%Y%m%d')}_{str(uuid.uuid4())[:8]}"

        # -- Données DB (events des 24 dernières heures) ----------------------
        db_events: list[dict[str, Any]] = []
        try:
            from db import engine
            from sqlalchemy import text

            async with engine.connect() as conn:
                rows = await conn.execute(
                    text("""
                        SELECT hazard_type, location_pcode, severity, status,
                               estimated_affected, start_date
                        FROM disaster_events
                        WHERE created_at >= NOW() - INTERVAL '24 hours'
                          AND deleted_at IS NULL
                        ORDER BY start_date DESC
                        LIMIT 500
                    """)
                )
                for row in rows:
                    db_events.append(dict(row._mapping))

            logger.info(
                "reporting_agent.db_events_fetched",
                count=len(db_events),
            )
        except Exception as db_exc:
            logger.warning(
                "reporting_agent.db_unavailable",
                error=str(db_exc),
            )

        # -- Signalements 24h depuis le store mémoire -------------------------
        signalements_24h: list[dict[str, Any]] = []
        try:
            from agents.signalements.agent import signalements_agent

            now_ts = generated_at.timestamp()
            for s in signalements_agent.get_store():
                try:
                    received_ts = datetime.fromisoformat(s["received_at"]).timestamp()
                    if now_ts - received_ts <= 86400:
                        signalements_24h.append(s)
                except Exception:
                    pass
        except Exception as sig_exc:
            logger.warning(
                "reporting_agent.signalements_unavailable",
                error=str(sig_exc),
            )

        # -- Scores de risque 7j depuis l'agent de prédiction -----------------
        risques_7j: list[dict[str, Any]] = []
        try:
            from agents.prediction.agent import prediction_agent

            scores = prediction_agent.get_scores(horizon=7)
            risques_7j = [
                {
                    "p_code": s.p_code,
                    "province": s.province,
                    "risk_type": s.risk_type.value,
                    "score": s.score,
                    "level": s.level.value,
                }
                for s in scores
                if s.score >= 40.0
            ]
        except Exception as pred_exc:
            logger.warning(
                "reporting_agent.prediction_unavailable",
                error=str(pred_exc),
            )

        # -- Agréger alertes actives par province depuis DB -------------------
        alertes_par_province: dict[str, list[dict[str, Any]]] = {}
        for ev in db_events:
            pcode = ev.get("location_pcode", "INCONNU")
            alertes_par_province.setdefault(pcode, []).append(ev)

        # -- Construire le bulletin -------------------------------------------
        bulletin: dict[str, Any] = {
            "report_id": report_id,
            "report_type": "daily_bulletin",
            "generated_at": generated_at.isoformat(),
            "period_start": generated_at.strftime("%Y-%m-%dT00:00:00Z"),
            "period_end": generated_at.isoformat(),
            "alertes_actives_par_province": alertes_par_province,
            "nouveaux_signalements_24h": {
                "total": len(signalements_24h),
                "par_classe": _count_by(signalements_24h, "classe"),
                "par_priorite": _count_by(signalements_24h, "priorite"),
            },
            "stocks_critiques": [],  # alimenté par Agent 4 (stocks)
            "distributions_24h": [],  # alimenté par Agent 4 (logistique)
            "anomalies": [],  # alimenté par Agent 3 (antifraud / anomalie_stocks)
            "risques_7j": risques_7j,
            "db_events_count": len(db_events),
        }

        _store_report(bulletin)

        # Générer et stocker export HXL des événements
        if db_events:
            hxl_csv = self.export_hxl(db_events)
            _store_hxl(hxl_csv, report_id=report_id)

        logger.info(
            "reporting_agent.daily_bulletin_generated",
            report_id=report_id,
            db_events=len(db_events),
            signalements=len(signalements_24h),
            risques=len(risques_7j),
        )
        return bulletin

    async def generate_weekly_summary(self) -> dict[str, Any]:
        """
        Génère le résumé exécutif hebdomadaire.

        Contenu :
          - Tendances sur 7 jours
          - Top 5 zones critiques
          - Recommandations
        """
        generated_at = datetime.now(timezone.utc)
        report_id = f"weekly_{generated_at.strftime('%Y_W%W')}_{str(uuid.uuid4())[:8]}"

        # Récupérer les bulletins quotidiens de la semaine écoulée
        daily_reports = [
            r
            for r in _REPORTS_STORE
            if r.get("report_type") == "daily_bulletin"
        ][-7:]  # 7 derniers bulletins

        # Agréger les signalements
        total_signalements = sum(
            r.get("nouveaux_signalements_24h", {}).get("total", 0)
            for r in daily_reports
        )

        # Top 5 zones critiques (par nombre d'alertes DB)
        province_counts: dict[str, int] = {}
        for r in daily_reports:
            for pcode, events in r.get("alertes_actives_par_province", {}).items():
                province_counts[pcode] = province_counts.get(pcode, 0) + len(events)

        top5 = sorted(province_counts.items(), key=lambda x: x[1], reverse=True)[:5]

        # Tendances risques (agrégation simple)
        risques_counts: dict[str, int] = {}
        for r in daily_reports:
            for risque in r.get("risques_7j", []):
                rt = risque.get("risk_type", "UNKNOWN")
                risques_counts[rt] = risques_counts.get(rt, 0) + 1

        # Recommandations génériques basées sur les données
        recommandations: list[str] = []
        if province_counts:
            top_pcode = top5[0][0] if top5 else ""
            if top_pcode:
                recommandations.append(
                    f"Renforcer la surveillance dans la province {top_pcode} "
                    f"({top5[0][1]} événements cette semaine)."
                )
        if risques_counts.get("FLOOD", 0) >= 3:
            recommandations.append(
                "Risque inondation persistant : préparer les pré-positionnements NFI."
            )
        if risques_counts.get("EPIDEMIC", 0) >= 2:
            recommandations.append(
                "Foyers épidémiques multiples détectés : activer protocole santé d'urgence."
            )
        if not recommandations:
            recommandations.append("Situation sous contrôle. Maintenir la surveillance de routine.")

        summary: dict[str, Any] = {
            "report_id": report_id,
            "report_type": "weekly_summary",
            "generated_at": generated_at.isoformat(),
            "period": f"{generated_at.strftime('%Y W%W')}",
            "tendances_7j": {
                "total_signalements": total_signalements,
                "par_type_risque": risques_counts,
                "bulletins_couverts": len(daily_reports),
            },
            "top5_zones_critiques": [
                {"pcode": pcode, "event_count": count} for pcode, count in top5
            ],
            "recommandations": recommandations,
        }

        _store_report(summary)

        logger.info(
            "reporting_agent.weekly_summary_generated",
            report_id=report_id,
            daily_reports_used=len(daily_reports),
            top5_zones=top5,
        )
        return summary

    async def generate_on_demand(
        self,
        report_type: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Génère un rapport à la demande selon report_type.

        report_type supportés :
          - "daily_bulletin" : bulletin quotidien immédiat
          - "weekly_summary" : résumé exécutif immédiat
          - "provincial"     : rapport pour une province donnée (params: pcode)
        """
        report_type_lower = report_type.lower()

        if report_type_lower == "daily_bulletin":
            return await self.generate_daily_bulletin()

        if report_type_lower == "weekly_summary":
            return await self.generate_weekly_summary()

        if report_type_lower == "provincial":
            pcode: str = params.get("pcode", "")
            if not pcode:
                raise ValueError("Le paramètre 'pcode' est requis pour un rapport provincial.")
            return await self._generate_provincial(pcode, params)

        raise ValueError(
            f"Type de rapport inconnu : '{report_type}'. "
            "Types supportés : daily_bulletin, weekly_summary, provincial."
        )

    async def _generate_provincial(
        self,
        pcode: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """Génère un rapport centré sur une province."""
        generated_at = datetime.now(timezone.utc)
        report_id = f"provincial_{pcode}_{generated_at.strftime('%Y%m%d')}_{str(uuid.uuid4())[:8]}"

        db_events: list[dict[str, Any]] = []
        try:
            from db import engine
            from sqlalchemy import text

            async with engine.connect() as conn:
                rows = await conn.execute(
                    text("""
                        SELECT hazard_type, location_pcode, severity, status,
                               estimated_affected, start_date
                        FROM disaster_events
                        WHERE location_pcode = :pcode
                          AND deleted_at IS NULL
                        ORDER BY start_date DESC
                        LIMIT 200
                    """),
                    {"pcode": pcode},
                )
                for row in rows:
                    db_events.append(dict(row._mapping))
        except Exception as db_exc:
            logger.warning(
                "reporting_agent.provincial_db_unavailable",
                pcode=pcode,
                error=str(db_exc),
            )

        signalements_province: list[dict[str, Any]] = []
        try:
            from agents.signalements.agent import signalements_agent

            signalements_province = [
                s
                for s in signalements_agent.get_store()
                if s.get("province", "").upper() == pcode.upper()
            ]
        except Exception:
            pass

        report: dict[str, Any] = {
            "report_id": report_id,
            "report_type": "provincial",
            "generated_at": generated_at.isoformat(),
            "pcode": pcode,
            "db_events": db_events,
            "signalements": signalements_province,
            "params": params,
        }

        _store_report(report)
        logger.info(
            "reporting_agent.provincial_generated",
            report_id=report_id,
            pcode=pcode,
            db_events=len(db_events),
            signalements=len(signalements_province),
        )
        return report

    # -----------------------------------------------------------------------
    # HXL Export
    # -----------------------------------------------------------------------

    def export_hxl(self, events_data: list[dict[str, Any]]) -> str:
        """
        Exporte les données d'événements en CSV avec en-tête HXL.

        Anonymisation stricte : aucun nom, téléphone ni identifiant individuel.
        Agrégation par P-code uniquement.

        Retourne une chaîne CSV (header noms + header HXL + lignes de données).
        """
        columns = list(HXL_TAGS.keys())
        hxl_header = list(HXL_TAGS.values())

        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")

        # Ligne 1 : noms de colonnes lisibles
        writer.writerow(columns)
        # Ligne 2 : tags HXL
        writer.writerow(hxl_header)

        for ev in events_data:
            row = [
                ev.get("province", ""),
                ev.get("location_pcode", ev.get("pcode", "")),
                ev.get("hazard_type", ev.get("event_type", "")),
                ev.get("estimated_affected", ev.get("affected_count", "")),
                _format_date(ev.get("start_date", ev.get("date", ""))),
                ev.get("severity", ""),
                ev.get("source", ""),
                ev.get("status", ""),
            ]
            writer.writerow(row)

        hxl_csv = output.getvalue()
        global _LATEST_HXL
        _LATEST_HXL = hxl_csv

        return hxl_csv

    # -----------------------------------------------------------------------
    # Accesseurs
    # -----------------------------------------------------------------------

    def get_reports(self, report_type: str | None = None) -> list[dict[str, Any]]:
        """Retourne les rapports stockés, filtrés par type si fourni."""
        if report_type is None:
            return list(_REPORTS_STORE)
        return [r for r in _REPORTS_STORE if r.get("report_type") == report_type]

    def get_report(self, report_id: str) -> dict[str, Any] | None:
        """Retourne un rapport par son ID, ou None si introuvable."""
        for r in _REPORTS_STORE:
            if r.get("report_id") == report_id:
                return r
        return None

    def get_latest_hxl(self) -> str:
        """Retourne le dernier export HXL (CSV anonymisé)."""
        return _LATEST_HXL

    def get_hxl_history(self) -> list[dict[str, Any]]:
        """Retourne l'historique des exports HXL."""
        return list(_HXL_HISTORY)


# ---------------------------------------------------------------------------
# Fonctions utilitaires (module-level)
# ---------------------------------------------------------------------------


def _store_report(report: dict[str, Any]) -> None:
    """Stocke un rapport dans le store en mémoire (max 100)."""
    _REPORTS_STORE.append(report)
    if len(_REPORTS_STORE) > _MAX_REPORTS:
        _REPORTS_STORE.pop(0)


def _store_hxl(hxl_csv: str, report_id: str = "") -> None:
    """Enregistre un export HXL dans l'historique."""
    global _LATEST_HXL
    _LATEST_HXL = hxl_csv
    _HXL_HISTORY.append(
        {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "report_id": report_id,
            "size_bytes": len(hxl_csv.encode()),
        }
    )


def _count_by(items: list[dict[str, Any]], key: str) -> dict[str, int]:
    """Compte les occurrences de items[key]."""
    counts: dict[str, int] = {}
    for item in items:
        val = str(item.get(key, "INCONNU"))
        counts[val] = counts.get(val, 0) + 1
    return counts


def _format_date(value: Any) -> str:
    """Formate une valeur date en ISO 8601 (YYYY-MM-DD)."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    return str(value)[:10] if str(value) else ""


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

reporting_agent = ReportingAgent()
