"""
Génération des polygones de Voronoï pour les quartiers (level=4).
À lancer une fois sur Windows : python generer_voronoi.py

Dépendances : pip install psycopg2-binary shapely scipy numpy
"""
import psycopg2
import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.validation import make_valid
import json

conn = psycopg2.connect(
    host="ep-odd-thunder-a2rh9ins.eu-central-1.aws.neon.tech",
    dbname="neondb",
    user="neondb_owner",
    password="npg_tfY0qJhRsx2M",
    sslmode="require"
)
cur = conn.cursor()

# ── Étape 1 : colonne geometry_type ──────────────────────────────────────────

cur.execute("ALTER TABLE admin_divisions ADD COLUMN IF NOT EXISTS geometry_type TEXT")
cur.execute("""
    UPDATE admin_divisions SET geometry_type = 'OFFICIEL'
    WHERE geometry IS NOT NULL AND geometry_type IS NULL
""")
conn.commit()
print("OK: Colonne geometry_type ajoutee, geometries existantes marquees OFFICIEL")


# ── Étape 2 : génération Voronoï ──────────────────────────────────────────────

def voronoi_cells(points, boundary):
    """Cellules de Voronoï découpées par la frontière de la commune."""
    if len(points) == 1:
        return [boundary]

    coords = np.array([[p[0], p[1]] for p in points])
    center = coords.mean(axis=0)
    radius = max(np.ptp(coords, axis=0).max() * 4, 0.05)
    far = np.array([
        center + [radius, 0],
        center + [-radius, 0],
        center + [0, radius],
        center + [0, -radius],
    ])
    try:
        vor = Voronoi(np.vstack([coords, far]))
    except Exception:
        return [boundary] * len(points)

    cells = []
    for i in range(len(points)):
        region = vor.regions[vor.point_region[i]]
        if -1 in region or not region:
            cells.append(None)
            continue
        try:
            poly = Polygon([vor.vertices[v] for v in region])
            clipped = poly.intersection(boundary)
            cells.append(clipped if not clipped.is_empty else None)
        except Exception:
            cells.append(None)
    return cells


def to_multipolygon(geom):
    """Force en MultiPolygon (type requis par la colonne)."""
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == 'Polygon':
        return MultiPolygon([geom])
    if geom.geom_type == 'MultiPolygon':
        return geom
    # GeometryCollection ou autre — extraire les polygones
    polys = [g for g in getattr(geom, 'geoms', []) if g.geom_type in ('Polygon', 'MultiPolygon')]
    if not polys:
        return None
    return MultiPolygon([p for g in polys for p in (g.geoms if g.geom_type == 'MultiPolygon' else [g])])


# Récupérer communes (level=3) avec géométrie
cur.execute("""
    SELECT pcode, ST_AsGeoJSON(geometry) FROM admin_divisions
    WHERE level = 3 AND geometry IS NOT NULL
""")
communes = cur.fetchall()
print(f"  {len(communes)} communes avec geometrie")

total, skipped = 0, 0
batch = 0

for commune_pcode, geom_json in communes:
    try:
        boundary = make_valid(shape(json.loads(geom_json)))
    except Exception:
        continue

    cur.execute("""
        SELECT pcode, ST_X(centroid), ST_Y(centroid) FROM admin_divisions
        WHERE level = 4 AND parent_pcode = %s AND centroid IS NOT NULL
    """, (commune_pcode,))
    quartiers = cur.fetchall()

    if not quartiers:
        continue

    points = [(q[1], q[2]) for q in quartiers]
    cells  = voronoi_cells(points, boundary)

    for (q_pcode, _, _), cell in zip(quartiers, cells):
        mp = to_multipolygon(cell)
        if mp is None:
            skipped += 1
            continue
        cur.execute("""
            UPDATE admin_divisions
            SET geometry      = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                geometry_type = 'VORONOI_APPROX'
            WHERE pcode = %s
        """, (json.dumps(mp.__geo_interface__), q_pcode))
        total += 1
        batch += 1

    if batch >= 100:
        conn.commit()
        batch = 0
        print(f"  ... {total} quartiers traites")

conn.commit()
print(f"\nDone: {total} quartiers avec zone Voronoi, {skipped} sans zone (pas de commune)")

# ── Vérification finale ───────────────────────────────────────────────────────
cur.execute("SELECT geometry_type, COUNT(*) FROM admin_divisions WHERE level=4 GROUP BY geometry_type")
for row in cur.fetchall():
    print(f"  level=4  geometry_type={row[0] or 'NULL'}  count={row[1]}")

cur.close()
conn.close()
