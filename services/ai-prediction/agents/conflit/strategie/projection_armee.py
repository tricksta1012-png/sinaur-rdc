"""
Projection de progression armée — logique de VALEUR STRATÉGIQUE.

Les groupes armés progressent vers ce qui sert leurs objectifs :
mines, axes commerciaux, frontières, villes-relais.
Jamais mécaniquement vers Kinshasa (sauf Mobondo, exception documentée).
"""
from __future__ import annotations

from db import engine
from sqlalchemy import text

from agents.conflit.strategie.logiques_deplacement import get_objectifs


async def projeter_progression_armee(
    groupe: str,
    p_code_actuel: str | None,
    coordonnees: tuple[float, float] | None,
) -> dict:
    """
    Calcule les cibles stratégiques probables d'un groupe armé.

    Args:
        groupe: Nom ACLED du groupe armé.
        p_code_actuel: Province actuelle (COD-AB).
        coordonnees: Position actuelle connue (lon, lat).

    Returns:
        dict avec cibles_probables, raisonnement, note.
    """
    objectifs = get_objectifs(groupe)
    types_valeur = objectifs.get("types_valeur", [])

    cibles: list[dict] = []

    # Position de référence pour le calcul de distance
    centroid_wkt: str | None = None
    if coordonnees:
        lon, lat = coordonnees
        centroid_wkt = f"SRID=4326;POINT({lon} {lat})"
    elif p_code_actuel:
        try:
            async with engine.connect() as conn:
                row = await conn.execute(
                    text("SELECT ST_AsText(centroid) FROM admin_divisions WHERE pcode = :pcode"),
                    {"pcode": p_code_actuel},
                )
                r = row.fetchone()
                if r and r[0]:
                    centroid_wkt = f"SRID=4326;{r[0]}"
        except Exception:
            pass

    if centroid_wkt and types_valeur:
        try:
            placeholders = ", ".join(f":tv{i}" for i in range(len(types_valeur)))
            params: dict = {"groupe": groupe, "pt": centroid_wkt}
            for i, tv in enumerate(types_valeur):
                params[f"tv{i}"] = tv

            async with engine.connect() as conn:
                rows = await conn.execute(
                    text(f"""
                        SELECT
                            nom, type_valeur, ressource, province_nom,
                            valeur_strategique,
                            groupes_interesses,
                            notes,
                            ST_Distance(coordinates::geography, :pt::geography) AS distance_m,
                            -- Score composite : valeur haute + distance faible
                            (valeur_strategique * 0.6)
                            + ((1.0 - LEAST(ST_Distance(coordinates::geography, :pt::geography) / 500000.0, 1.0)) * 0.4)
                            AS score_priorite
                        FROM point_strategique
                        WHERE actif = true
                          AND (:groupe = ANY(groupes_interesses)
                               OR type_valeur IN ({placeholders}))
                        ORDER BY score_priorite DESC
                        LIMIT 4
                    """),
                    params,
                )
                for r in rows:
                    rd = dict(r._mapping)
                    cibles.append({
                        "nom":                rd["nom"],
                        "type_valeur":        rd["type_valeur"],
                        "ressource":          rd.get("ressource"),
                        "province":           rd["province_nom"],
                        "valeur_strategique": float(rd["valeur_strategique"]),
                        "distance_km":        round(float(rd["distance_m"]) / 1000, 0),
                        "score_priorite":     round(float(rd["score_priorite"]), 2),
                        "notes":              rd.get("notes"),
                    })
        except Exception:
            cibles = _fallback_cibles(groupe, types_valeur)
    else:
        cibles = _fallback_cibles(groupe, types_valeur)

    raisonnement = _construire_raisonnement(groupe, objectifs, cibles)

    return {
        "groupe":           groupe,
        "objectif_connu":   objectifs.get("objectif_primaire", "Non documenté"),
        "logique_groupe":   objectifs.get("logique", ""),
        "vise_capitale":    objectifs.get("vise_capitale", False),
        "cibles_probables": cibles[:3],
        "raisonnement":     raisonnement,
        "note": (
            "Hypothèse basée sur les objectifs documentés du groupe et "
            "la proximité des points de valeur connus. "
            "Un groupe peut surprendre — valider avec les sources terrain."
        ),
    }


def _construire_raisonnement(groupe: str, objectifs: dict, cibles: list[dict]) -> str:
    obj = objectifs.get("objectif_primaire", "objectifs non documentés")
    logique = objectifs.get("logique", "")
    vise_cap = objectifs.get("vise_capitale", False)

    if vise_cap:
        direction = f"{groupe} est le seul groupe dont l'expansion peut atteindre la périphérie de Kinshasa."
    else:
        direction = f"{groupe} ne vise pas Kinshasa — ses objectifs sont locaux/régionaux."

    if not cibles:
        return (
            f"{groupe} : {obj}. {logique} "
            f"{direction} "
            "Aucun point stratégique proche identifié dans la base — enrichir les données terrain."
        )

    top = cibles[0]
    res = f" ({top['ressource']})" if top.get("ressource") else ""
    return (
        f"{groupe} vise typiquement : {obj}. {logique} "
        f"Cible la plus probable : {top['nom']}{res} "
        f"({top['type_valeur']}, ~{int(top['distance_km'])} km, "
        f"valeur stratégique {int(top['valeur_strategique'] * 100)}%). "
        f"{direction}"
    )


def _fallback_cibles(groupe: str, types_valeur: list[str]) -> list[dict]:
    """Cibles hardcodées si la DB géospatiale est indisponible."""
    FALLBACKS: dict[str, list[dict]] = {
        "M23/AFC": [
            {"nom": "Rubaya (coltan)",   "type_valeur": "MINE",          "ressource": "coltan",
             "province": "Nord-Kivu",   "valeur_strategique": 0.95, "distance_km": 50,  "score_priorite": 0.80, "notes": None},
            {"nom": "Axe Goma–Rutshuru","type_valeur": "AXE_COMMERCIAL", "ressource": "corridor",
             "province": "Nord-Kivu",   "valeur_strategique": 0.90, "distance_km": 30,  "score_priorite": 0.78, "notes": None},
        ],
        "CODECO": [
            {"nom": "Zones aurifères Djugu", "type_valeur": "MINE", "ressource": "or",
             "province": "Ituri", "valeur_strategique": 0.88, "distance_km": 40, "score_priorite": 0.72, "notes": None},
        ],
        "ADF": [
            {"nom": "Forêt Beni–Mambasa", "type_valeur": "BASTION", "ressource": "refuge",
             "province": "Nord-Kivu", "valeur_strategique": 0.85, "distance_km": 20, "score_priorite": 0.70, "notes": None},
        ],
        "Mobondo": [
            {"nom": "Maluku (accès Kinshasa)", "type_valeur": "VILLE_RELAIS", "ressource": "terres",
             "province": "Kinshasa", "valeur_strategique": 0.72, "distance_km": 150, "score_priorite": 0.58, "notes": None},
            {"nom": "Kwamouth", "type_valeur": "VILLE_RELAIS", "ressource": "terres",
             "province": "Maï-Ndombe", "valeur_strategique": 0.78, "distance_km": 50, "score_priorite": 0.65, "notes": None},
        ],
    }
    return FALLBACKS.get(groupe, [])
