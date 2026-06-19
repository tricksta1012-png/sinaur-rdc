import geopandas as gpd
import psycopg2
import os

DATABASE_URL = os.environ['DATABASE_URL']
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

# (fichier, niveau, colonne pcode)
NIVEAUX = [
    ('cod_admin1.shp', 1, 'adm1_pcode'),
    ('cod_admin2.shp', 2, 'adm2_pcode'),
    ('cod_admin3.shp', 3, 'adm3_pcode'),
]

for fichier, niveau, pcode_col in NIVEAUX:
    print(f"\n=== Niveau {niveau} : {fichier} ===")
    gdf = gpd.read_file(f'cod-ab/{fichier}').to_crs('EPSG:4326')
    print(f"{len(gdf)} entites lues.")
    maj, absents = 0, 0

    for _, row in gdf.iterrows():
        pcode = row[pcode_col]
        geom_wkt = row['geometry'].wkt
        b = row['geometry'].bounds
        bbox_array = [b[0], b[1], b[2], b[3]]
        cur.execute("""
            UPDATE admin_divisions
            SET geometry = ST_GeomFromText(%s, 4326),
                centroid = ST_Centroid(ST_GeomFromText(%s, 4326)),
                bbox     = %s
            WHERE pcode = %s AND level = %s
        """, [geom_wkt, geom_wkt, bbox_array, pcode, niveau])
        if cur.rowcount > 0:
            maj += 1
        else:
            absents += 1
            if absents <= 5:
                print(f"  pcode sans correspondance : {pcode} ({row[pcode_col.replace('pcode','name')]})")

    conn.commit()
    print(f"  Resultat niveau {niveau} : {maj} mises a jour, {absents} sans correspondance.")

cur.close()
conn.close()
print("\n=== Import termine ===")