"""
Persistence des événements conflit bruts et corroborés en base de données.

conflict_event_raw          — un enregistrement par source et par événement externe
conflict_event_corroborated — un enregistrement par cluster (upsert sur cluster_hash)
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import text

from db import engine

logger = structlog.get_logger(__name__)


# ── Raw events ────────────────────────────────────────────────────────────────

async def save_raw_events(events: list[dict]) -> int:
    """
    Upsert raw events into conflict_event_raw.
    ON CONFLICT (source, external_id) DO NOTHING pour éviter les doublons.
    Retourne le nombre de lignes insérées.
    """
    if not events:
        return 0

    inserted = 0
    async with engine.begin() as conn:
        for ev in events:
            coords = ev.get("coordinates")
            geom: str | None = None
            if coords and len(coords) == 2:
                try:
                    geom = f"SRID=4326;POINT({float(coords[0])} {float(coords[1])})"
                except (TypeError, ValueError):
                    pass

            try:
                result = await conn.execute(
                    text("""
                        INSERT INTO conflict_event_raw
                            (source, external_id, province, p_code, territoire,
                             event_type, event_date, severity, displacement_risk,
                             location,
                             fatalities_low, fatalities_high,
                             actors_raw, raw_notes, source_url,
                             source_reliability, needs_corroboration, raw_payload)
                        VALUES
                            (:source, :external_id, :province, :p_code, :territoire,
                             :event_type, :event_date::timestamptz, :severity, :displacement_risk,
                             CASE WHEN :geom IS NULL THEN NULL
                                  ELSE ST_GeomFromEWKT(:geom) END,
                             :fatalities_low, :fatalities_high,
                             :actors_raw::jsonb, :raw_notes, :source_url,
                             :source_reliability, :needs_corroboration, :raw_payload::jsonb)
                        ON CONFLICT (source, external_id) DO NOTHING
                    """),
                    {
                        "source":              str(ev.get("source") or "unknown"),
                        "external_id":         str(ev.get("external_id") or ""),
                        "province":            str(ev.get("province") or "Unknown"),
                        "p_code":              ev.get("p_code"),
                        "territoire":          ev.get("territoire"),
                        "event_type":          str(ev.get("event_type") or "conflict"),
                        "event_date":          _coerce_dt(ev.get("event_date")),
                        "severity":            int(ev.get("severity") or 1),
                        "displacement_risk":   float(ev.get("displacement_risk") or 0.0),
                        "geom":                geom,
                        "fatalities_low":      _int_or_none(ev.get("fatalities_low")),
                        "fatalities_high":     _int_or_none(ev.get("fatalities_high")),
                        "actors_raw":          json.dumps(ev.get("actor_names") or []),
                        "raw_notes":           ev.get("raw_notes"),
                        "source_url":          ev.get("source_url"),
                        "source_reliability":  float(ev.get("reliability_score") or ev.get("source_reliability") or 0.5),
                        "needs_corroboration": bool(ev.get("needs_corroboration", False)),
                        "raw_payload":         json.dumps(_safe_payload(ev)),
                    },
                )
                inserted += result.rowcount
            except Exception as exc:
                logger.warning(
                    "conflit.persist.raw_insert_failed",
                    error=str(exc),
                    external_id=ev.get("external_id"),
                    source=ev.get("source"),
                )

    logger.info("conflit.persist.raw_saved", inserted=inserted, total=len(events))
    return inserted


# ── Corroborated clusters ─────────────────────────────────────────────────────

async def upsert_corroborated(events: list[dict]) -> int:
    """
    Upsert corroborated cluster records into conflict_event_corroborated.
    Le cluster_hash est dérivé de (province, event_type_normalisé, date_bucket_48h).
    ON CONFLICT (cluster_hash) DO UPDATE pour mettre à jour le score.
    Retourne le nombre de lignes upsertées.
    """
    if not events:
        return 0

    upserted = 0
    async with engine.begin() as conn:
        for ev in events:
            cluster_hash = _compute_cluster_hash(ev)
            sources_list = ev.get("sources_list") or [ev.get("source", "unknown")]
            sources_count = ev.get("sources_count", len(sources_list))
            score = float(ev.get("corroboration_score") or 0.0)
            academic = "acled" in sources_list and "ucdp_ged" in sources_list

            try:
                result = await conn.execute(
                    text("""
                        INSERT INTO conflict_event_corroborated
                            (cluster_hash, province, event_type, event_date,
                             severity, displacement_risk,
                             sources_count, sources_list, corroboration_score,
                             corroboration_detail, academic_concordance,
                             needs_corroboration, contradictions,
                             fatalities_reported, fatalities_low, fatalities_high,
                             actors_consolidated, coordinates, raw_event_ids)
                        VALUES
                            (:cluster_hash, :province, :event_type, :event_date::timestamptz,
                             :severity, :displacement_risk,
                             :sources_count, :sources_list::jsonb, :corroboration_score,
                             :corroboration_detail, :academic_concordance,
                             :needs_corroboration, :contradictions::jsonb,
                             :fatalities_reported, :fatalities_low, :fatalities_high,
                             :actors_consolidated::jsonb, :coordinates::jsonb, '[]'::jsonb)
                        ON CONFLICT (cluster_hash) DO UPDATE SET
                            sources_count        = EXCLUDED.sources_count,
                            sources_list         = EXCLUDED.sources_list,
                            corroboration_score  = EXCLUDED.corroboration_score,
                            corroboration_detail = EXCLUDED.corroboration_detail,
                            academic_concordance = EXCLUDED.academic_concordance,
                            needs_corroboration  = EXCLUDED.needs_corroboration,
                            contradictions       = EXCLUDED.contradictions,
                            fatalities_reported  = COALESCE(EXCLUDED.fatalities_reported, conflict_event_corroborated.fatalities_reported),
                            fatalities_low       = COALESCE(EXCLUDED.fatalities_low, conflict_event_corroborated.fatalities_low),
                            fatalities_high      = COALESCE(EXCLUDED.fatalities_high, conflict_event_corroborated.fatalities_high),
                            actors_consolidated  = EXCLUDED.actors_consolidated,
                            coordinates          = COALESCE(EXCLUDED.coordinates, conflict_event_corroborated.coordinates),
                            updated_at           = NOW()
                    """),
                    {
                        "cluster_hash":         cluster_hash,
                        "province":             str(ev.get("province") or "Unknown"),
                        "event_type":           str(ev.get("event_type") or "conflict"),
                        "event_date":           _coerce_dt(ev.get("event_date")),
                        "severity":             int(ev.get("severity") or 1),
                        "displacement_risk":    float(ev.get("displacement_risk") or 0.0),
                        "sources_count":        int(sources_count),
                        "sources_list":         json.dumps(sources_list),
                        "corroboration_score":  score,
                        "corroboration_detail": ev.get("corroboration_detail"),
                        "academic_concordance": academic,
                        "needs_corroboration":  bool(ev.get("needs_corroboration", False)),
                        "contradictions":       json.dumps(ev.get("contradictions") or []),
                        "fatalities_reported":  _int_or_none(ev.get("fatalities_reported")),
                        "fatalities_low":       _int_or_none(ev.get("fatalities_low")),
                        "fatalities_high":      _int_or_none(ev.get("fatalities_high")),
                        "actors_consolidated":  json.dumps(ev.get("actor_names") or []),
                        "coordinates":          json.dumps(ev.get("coordinates")) if ev.get("coordinates") else None,
                    },
                )
                upserted += result.rowcount
            except Exception as exc:
                logger.warning(
                    "conflit.persist.corroborated_upsert_failed",
                    error=str(exc),
                    cluster_hash=cluster_hash,
                )

    logger.info("conflit.persist.corroborated_upserted", upserted=upserted, total=len(events))
    return upserted


# ── Helpers ───────────────────────────────────────────────────────────────────

def _compute_cluster_hash(ev: dict) -> str:
    """Hash déterministe : province + type normalisé + bucket 48h."""
    province = str(ev.get("province") or ev.get("p_code") or "unknown").lower()
    etype    = _normalize_type(str(ev.get("event_type") or "conflict"))
    dt       = _coerce_dt(ev.get("event_date"))
    # Bucket 48h : arrondi au nombre de périodes de 48h depuis epoch
    epoch_hours  = int(dt.timestamp() / 3600)
    bucket       = epoch_hours // 48
    raw = f"{province}|{etype}|{bucket}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _normalize_type(t: str) -> str:
    t = t.lower()
    if any(k in t for k in ("conflict", "conflit", "battle", "combat", "attack", "violence")):
        return "conflict"
    if any(k in t for k in ("displacement", "deplacement")):
        return "displacement"
    return t or "other"


def _coerce_dt(val: Any) -> datetime:
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    if isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val[:19])
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _int_or_none(val: Any) -> int | None:
    try:
        return int(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _safe_payload(ev: dict) -> dict:
    """Sérialise le payload en supprimant les valeurs non-JSON-sérialisables."""
    out = {}
    for k, v in ev.items():
        if isinstance(v, (str, int, float, bool, list, dict)) or v is None:
            out[k] = v
        else:
            out[k] = str(v)
    return out
