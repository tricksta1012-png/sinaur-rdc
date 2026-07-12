"""
Projection de fuite civile — logique de PROXIMITÉ.

Les populations fuient vers la sécurité la plus proche :
ville sûre, camp de déplacés, frontière internationale.
Jamais mécaniquement vers la capitale (1 600 km pour l'Est).
"""
from __future__ import annotations

from db import engine
from sqlalchemy import text

# Rayon de recherche de refuges (200 km est pertinent pour l'Est-RDC)
_RAYON_REFUGE_KM = 200_000  # mètres — ST_Distance retourne des mètres

# Provinces considérées comme relativement sûres (à actualiser)
# On exclut les provinces en crise aiguë de la liste des refuges
_STATUTS_SURETE = ("NORMAL", "VIGILANCE")

# Frontières proches connues (camps de réfugiés transfrontaliers)
_FRONTIERES_PROCHES: list[dict] = [
    {"nom": "Ouganda (Kamwenge/Kyangwali)", "lon": 30.17, "lat":  0.52, "capacite": "grande"},
    {"nom": "Rwanda (Goma–Gisenyi)",         "lon": 29.26, "lat": -1.71, "capacite": "limitée"},
    {"nom": "Burundi (Uvira–Bujumbura)",     "lon": 29.14, "lat": -3.39, "capacite": "moyenne"},
    {"nom": "Tanzanie (Kigoma)",              "lon": 29.62, "lat": -4.88, "capacite": "grande"},
    {"nom": "Zambie (Mpulungu)",              "lon": 30.02, "lat": -8.77, "capacite": "limitée"},
]


async def projeter_fuite_civile(
    lieu_danger: str,
    p_code_danger: str | None,
    coordonnees: tuple[float, float] | None,
) -> dict:
    """
    Calcule les destinations probables des populations fuyant un lieu de danger.

    Args:
        lieu_danger: Nom du lieu en danger (province ou territoire).
        p_code_danger: Code COD-AB de la province en danger.
        coordonnees: (longitude, latitude) du lieu de danger, si connues.

    Returns:
        dict avec destinations_probables, axes_surveillance, raisonnement.
    """
    destinations: list[dict] = []
    frontieres_proches: list[dict] = []

    # Chercher le centroïde de la province si pas de coordonnées précises
    centroid_wkt: str | None = None
    if coordonnees:
        lon, lat = coordonnees
        centroid_wkt = f"SRID=4326;POINT({lon} {lat})"
    elif p_code_danger:
        try:
            async with engine.connect() as conn:
                row = await conn.execute(
                    text("SELECT ST_AsText(centroid) FROM admin_divisions WHERE pcode = :pcode"),
                    {"pcode": p_code_danger},
                )
                r = row.fetchone()
                if r and r[0]:
                    centroid_wkt = f"SRID=4326;{r[0]}"
        except Exception:
            pass

    if centroid_wkt:
        try:
            async with engine.connect() as conn:
                rows = await conn.execute(
                    text("""
                        SELECT
                            name_fr,
                            pcode,
                            ST_Distance(centroid::geography, :pt::geography) AS distance_m
                        FROM admin_divisions
                        WHERE level = 1
                          AND pcode != :danger_pcode
                          AND ST_Distance(centroid::geography, :pt::geography) < :rayon
                        ORDER BY distance_m
                        LIMIT 5
                    """),
                    {
                        "pt":          centroid_wkt,
                        "danger_pcode": p_code_danger or "",
                        "rayon":       _RAYON_REFUGE_KM,
                    },
                )
                for r in rows:
                    rd = dict(r._mapping)
                    destinations.append({
                        "nom":        rd["name_fr"],
                        "pcode":      rd["pcode"],
                        "distance_km": round(rd["distance_m"] / 1000, 0),
                    })

                # Frontières proches (requête géographique directe)
                for frontiere in _FRONTIERES_PROCHES:
                    row_f = await conn.execute(
                        text("""
                            SELECT ST_Distance(
                                :pt::geography,
                                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                            ) AS distance_m
                        """),
                        {"pt": centroid_wkt, "lon": frontiere["lon"], "lat": frontiere["lat"]},
                    )
                    rf = row_f.fetchone()
                    if rf and rf[0] < _RAYON_REFUGE_KM:
                        frontieres_proches.append({
                            "nom":         frontiere["nom"],
                            "distance_km": round(rf[0] / 1000, 0),
                            "capacite":    frontiere["capacite"],
                        })

        except Exception as exc:
            destinations = _fallback_destinations(lieu_danger, p_code_danger)
    else:
        destinations = _fallback_destinations(lieu_danger, p_code_danger)

    # Construire le raisonnement
    if destinations:
        top = destinations[0]
        raisonnement = (
            f"Les populations de {lieu_danger} fuient vers la sécurité la plus proche, "
            f"pas vers Kinshasa. Refuge le plus probable : {top['nom']} "
            f"(~{int(top['distance_km'])} km). "
        )
        if frontieres_proches:
            raisonnement += (
                f"Option transfrontalière : {frontieres_proches[0]['nom']} "
                f"(~{int(frontieres_proches[0]['distance_km'])} km)."
            )
    else:
        raisonnement = (
            f"Données géographiques insuffisantes pour {lieu_danger}. "
            "Appliquer la règle générale : les populations fuient vers la ville sûre la plus proche."
        )

    axes = _identifier_axes_surveillance(lieu_danger, p_code_danger, destinations)

    return {
        "lieu_danger":            lieu_danger,
        "destinations_probables": destinations[:3],
        "frontieres_proches":     frontieres_proches[:2],
        "axes_surveillance":      axes,
        "raisonnement":           raisonnement,
        "note":                   (
            "Hypothèse basée sur la proximité géographique et la sécurité relative des zones. "
            "Les flux réels dépendent des routes praticables et des points de passage. "
            "Surveiller les axes routiers pour anticiper les besoins humanitaires."
        ),
    }


def _fallback_destinations(lieu: str, p_code: str | None) -> list[dict]:
    """Destinations de repli hardcodées si la DB géospatiale est indisponible."""
    FALLBACKS: dict[str, list[dict]] = {
        "CD61": [  # Nord-Kivu
            {"nom": "Goma",    "pcode": "CD61", "distance_km": 0},
            {"nom": "Butembo", "pcode": "CD61", "distance_km": 130},
        ],
        "CD62": [  # Sud-Kivu
            {"nom": "Bukavu",  "pcode": "CD62", "distance_km": 0},
            {"nom": "Uvira",   "pcode": "CD62", "distance_km": 110},
        ],
        "CD54": [  # Ituri
            {"nom": "Bunia",   "pcode": "CD54", "distance_km": 0},
            {"nom": "Aru",     "pcode": "CD54", "distance_km": 120},
        ],
        "CD23": [  # Maï-Ndombe
            {"nom": "Inongo",  "pcode": "CD23", "distance_km": 0},
            {"nom": "Bandundu","pcode": "CD22", "distance_km": 150},
        ],
    }
    return FALLBACKS.get(p_code or "", [])


def _identifier_axes_surveillance(
    lieu: str,
    p_code: str | None,
    destinations: list[dict],
) -> list[str]:
    """Axes routiers à surveiller pour les colonnes de déplacés."""
    AXES: dict[str, list[str]] = {
        "CD61": [
            "RN2 Rutshuru–Goma (axe principal de fuite Nord-Kivu)",
            "RN4 Goma–Butembo (fuite vers le nord)",
            "Axe Minova–Sake–Goma (fuite depuis Masisi)",
        ],
        "CD62": [
            "RN2 Bukavu–Uvira (fuite vers les hauts plateaux ou Burundi)",
            "Route Kalehe–Minova (fuite vers le lac Kivu)",
        ],
        "CD54": [
            "Route Bunia–Komanda (fuite vers l'intérieur)",
            "Axe Bunia–Ouganda (fuite transfrontalière)",
        ],
        "CD23": [
            "Route Kwamouth–Bandundu (fuite vers l'ouest)",
            "Fleuve Congo (fuite par voie fluviale)",
        ],
    }
    return AXES.get(p_code or "", [
        f"Routes principales reliant {lieu} aux zones sûres identifiées ci-dessus",
    ])
