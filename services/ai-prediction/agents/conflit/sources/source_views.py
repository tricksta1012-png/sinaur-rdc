"""
Connecteur VIEWS — Violence Early Warning System.
Source : viewsforecasting.org (Uppsala University / PRIO).
Prévisions mensuelles par grille PRIO-GRID 55×55km.
Accès libre (données ouvertes) — cadence hebdomadaire.

VIEWS ne remplace pas les sources terrain (ACLED, UCDP) — c'est un modèle
macro long-terme (1-36 mois). SINAUR le consomme comme une source
de prévision parmi d'autres, pas comme un oracle.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone

import httpx
import structlog

logger = structlog.get_logger(__name__)

BASE_URL = "https://api.viewsforecasting.org"
_DRC_GWNO = 490       # Gleditsch-Ward number pour la RDC
_PAGE_SIZE = 2000
_TIMEOUT = 120.0

# Boîtes englobantes approximatives des provinces RDC.
# Ordonnées de la plus petite à la plus grande superficie pour que le
# match "plus spécifique" l'emporte en cas de chevauchement.
_PROVINCE_BOUNDS: list[tuple[str, str, float, float, float, float, str]] = [
    # (pred_pcode, codab, lat_min, lat_max, lon_min, lon_max, nom)
    ("CD-KN",  "CD10",  -4.70,  -4.20,  15.00, 15.60, "Kinshasa"),
    ("CD-NK",  "CD61",  -2.00,   1.50,  27.50, 30.50, "Nord-Kivu"),
    ("CD-IT",  "CD54",   0.50,   4.50,  28.50, 31.50, "Ituri"),
    ("CD-SK",  "CD62",  -5.00,  -0.50,  26.50, 30.00, "Sud-Kivu"),
    ("CD-MN",  "CD63",  -5.50,  -0.50,  24.50, 29.00, "Maniema"),
    ("CD-TA",  "CD74",  -9.00,  -4.00,  27.50, 31.50, "Tanganyika"),
    ("CD-HK",  "CD71", -13.50,  -8.00,  26.50, 31.00, "Haut-Katanga"),
    ("CD-HU",  "CD53",   1.50,   5.50,  25.50, 31.50, "Haut-Uele"),
    ("CD-BU",  "CD52",   2.00,   5.00,  22.00, 27.50, "Bas-Uele"),
    ("CD-HL",  "CD73",  -9.00,  -5.00,  24.00, 28.50, "Haut-Lomami"),
    ("CD-LO",  "CD72", -11.50,  -7.00,  22.00, 28.00, "Lualaba"),
    ("CD-TP",  "CD51",   0.00,   4.00,  23.00, 28.50, "Tshopo"),
    ("CD-SU",  "CD85",  -5.50,  -1.50,  22.50, 27.00, "Sankuru"),
    ("CD-MK",  "CD82",  -8.00,  -4.00,  23.50, 27.00, "Kasaï-Oriental"),
    ("CD-LM",  "CD81",  -8.50,  -4.00,  23.50, 27.50, "Lomami"),
    ("CD-MO",  "CD44",   1.00,   4.00,  19.50, 23.50, "Mongala"),
    ("CD-NU",  "CD43",   3.00,   5.50,  20.00, 24.50, "Nord-Ubangi"),
    ("CD-SA",  "CD42",   2.50,   5.50,  17.50, 20.50, "Sud-Ubangi"),
    ("CD-KC2", "CD84",  -7.50,  -4.00,  20.00, 24.50, "Kasaï-Central"),
    ("CD-KC",  "CD83",  -7.50,  -3.50,  19.00, 23.50, "Kasaï"),
    ("CD-EQ",  "CD41",  -2.50,   2.50,  18.00, 23.00, "Équateur"),
    ("CD-KW",  "CD22",  -6.50,  -3.00,  16.50, 20.50, "Kwilu"),
    ("CD-KO",  "CD21",  -7.00,  -3.50,  16.50, 21.50, "Kwango"),
    ("CD-MN2", "CD23",  -4.00,  -0.50,  16.50, 22.00, "Maï-Ndombe"),
    ("CD-BC",  "CD20",  -5.50,  -3.50,  12.20, 17.00, "Kongo-Central"),
]


def _month_id_to_date(month_id: int) -> date:
    """Convertit un month_id VIEWS (mois depuis 1980-01) en date Python."""
    year = 1980 + (month_id - 1) // 12
    month = (month_id - 1) % 12 + 1
    return date(year, month, 1)


def _grid_to_province(lat: float, lon: float) -> tuple[str, str, str] | None:
    """Trouve la province RDC contenant ce point, en préférant la bbox la plus petite."""
    best: tuple[str, str, str] | None = None
    best_area = float("inf")
    for pred_code, codab, lat_min, lat_max, lon_min, lon_max, name in _PROVINCE_BOUNDS:
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            area = (lat_max - lat_min) * (lon_max - lon_min)
            if area < best_area:
                best = (pred_code, codab, name)
                best_area = area
    return best


async def _fetch_latest_run_id(client: httpx.AsyncClient) -> str | None:
    """Récupère le run_id du dernier run PRIO-GRID publié."""
    try:
        resp = await client.get(f"{BASE_URL}/runs/", timeout=30.0)
        resp.raise_for_status()
        data = resp.json()
        runs = data if isinstance(data, list) else data.get("results", data.get("runs", []))
        pgm_runs = [
            r for r in (runs if isinstance(runs, list) else [])
            if "pgm" in str(r.get("run_id", r.get("id", ""))).lower()
        ]
        if pgm_runs:
            latest = pgm_runs[-1]
            return latest.get("run_id") or latest.get("id")
        # Si pas de runs listés, tenter endpoint direct
        if runs and not pgm_runs:
            any_run = runs[-1]
            return any_run.get("run_id") or any_run.get("id")
    except Exception as exc:
        logger.debug("views.runs_endpoint_failed", error=str(exc))
    return None


async def _fetch_predictions_page(
    client: httpx.AsyncClient,
    run_id: str,
    offset: int,
) -> tuple[list[dict], bool]:
    """Récupère une page de prédictions PRIO-GRID. Retourne (rows, has_more)."""
    endpoints = [
        f"{BASE_URL}/pgm/runs/{run_id}/predictions/",
        f"{BASE_URL}/pgm/{run_id}/predictions/",
        f"{BASE_URL}/pgm/predictions/{run_id}/",
    ]
    params: dict = {"page_size": _PAGE_SIZE, "offset": offset}
    # Filtre DRC — différentes conventions de nommage selon la version API
    for gwno_param in ["gwno_c", "country_gwno", "gwno"]:
        params[gwno_param] = _DRC_GWNO

    for endpoint in endpoints:
        try:
            resp = await client.get(endpoint, params=params, timeout=_TIMEOUT)
            if resp.status_code == 404:
                continue
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", data if isinstance(data, list) else [])
            has_more = bool(data.get("next")) if isinstance(data, dict) else False
            return results, has_more
        except httpx.HTTPStatusError:
            continue
        except Exception as exc:
            logger.debug("views.page_fetch_failed", endpoint=endpoint, error=str(exc))
            continue

    return [], False


def _normalise_row(row: dict, now: datetime) -> dict | None:
    """Convertit une ligne VIEWS PRIO-GRID en enregistrement prevision_conflit."""
    # Coordonnées
    lat = row.get("lat") or row.get("latitude") or row.get("centroid_lat")
    lon = row.get("lon") or row.get("longitude") or row.get("centroid_lon")
    if lat is None or lon is None:
        return None

    province_match = _grid_to_province(float(lat), float(lon))
    if province_match is None:
        return None
    pred_code, codab, province_nom = province_match

    # Identifiant de grille — requis pour l'unicité
    grid_id = str(
        row.get("pg_id") or row.get("priogrid_gid") or row.get("pgid") or row.get("gid") or ""
    )
    if not grid_id:
        return None

    # Mois cible
    month_id = row.get("month_id") or row.get("mid")
    try:
        if month_id is not None:
            mois_cible = _month_id_to_date(int(month_id))
        else:
            month_str = row.get("month_start") or row.get("date") or row.get("period")
            if not month_str:
                return None
            mois_cible = date.fromisoformat(str(month_str)[:10])

        delta = (mois_cible.year - now.date().year) * 12 + (mois_cible.month - now.date().month)
        if delta < 1 or delta > 36:
            return None
        horizon_mois = delta
    except Exception:
        return None

    # Estimations de mortalité (plusieurs conventions de nommage)
    def _float(key: str) -> float:
        v = row.get(key)
        return float(v) if v is not None else 0.0

    sb  = _float("sb_best")  or _float("fatalities_sb") or _float("ln_sb_best")
    ns  = _float("ns_best")  or _float("fatalities_ns") or _float("ln_ns_best")
    os_ = _float("os_best")  or _float("fatalities_os") or _float("ln_os_best")
    total = sb + ns + os_

    # Probabilité de conflit
    prob_raw = (
        row.get("prob_sb") or row.get("prob_any") or
        row.get("bds_sb_1") or row.get("pr_sb")
    )
    if prob_raw is not None:
        probabilite = min(1.0, max(0.0, float(prob_raw)))
    else:
        # Approximation si pas de champ prob direct
        probabilite = min(1.0, total / 20.0) if total > 0 else 0.0

    return {
        "source":          "VIEWS",
        "province_pcode":  codab,
        "pred_pcode":      pred_code,
        "province_nom":    province_nom,
        "zone_grid":       grid_id,
        "lat":             float(lat),
        "lon":             float(lon),
        "morts_predites":  round(total, 2),
        "probabilite":     round(probabilite, 4),
        "horizon_mois":    horizon_mois,
        "mois_cible":      mois_cible.isoformat(),
        "type_violence":   "total",
    }


async def fetch_views_previsions() -> list[dict]:
    """
    Collecte les prévisions VIEWS pour la RDC.
    Retourne des enregistrements normalisés pour la table prevision_conflit.
    """
    now = datetime.now(timezone.utc)
    previsions: list[dict] = []

    async with httpx.AsyncClient(
        headers={"User-Agent": "SINAUR-RDC/1.0 (humanitarian; contact@sinaur.cd)"},
        follow_redirects=True,
    ) as client:
        run_id = await _fetch_latest_run_id(client)
        if not run_id:
            logger.warning("views.no_run_id_available",
                           note="Vérifier que api.viewsforecasting.org est accessible")
            return []

        logger.info("views.fetching_drc_forecasts", run_id=run_id)

        offset = 0
        pages_fetched = 0
        while pages_fetched < 20:  # max 40 000 lignes
            rows, has_more = await _fetch_predictions_page(client, run_id, offset)
            if not rows:
                break

            for row in rows:
                rec = _normalise_row(row, now)
                if rec:
                    previsions.append(rec)

            pages_fetched += 1
            if not has_more:
                break
            offset += _PAGE_SIZE
            await asyncio.sleep(0.15)

    logger.info("views.fetch_done",
                total_records=len(previsions),
                run_id=run_id,
                pages=pages_fetched)
    return previsions
