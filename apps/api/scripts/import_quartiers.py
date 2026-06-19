"""
Import des quartiers/groupements (niveau 4) depuis OpenStreetMap via Overpass API.
Source : OSM place=suburb|neighbourhood|quarter pour chaque province RDC.
Rattachement : ST_Contains contre le niveau 3 (commune/zone de sante) en base.

Usage :
    $env:DATABASE_URL = "postgresql://..."
    python3 import_quartiers.py
"""
import httpx
import psycopg2
import os
import re
import time
import unicodedata

DATABASE_URL = os.environ['DATABASE_URL']
OVERPASS    = "https://overpass-api.de/api/interpreter"
HEADERS     = {"User-Agent": "SINAUR-RDC/1.0 (plateforme humanitaire RDC; contact@sinaur-rdc.cd)"}

# Mots-cles identifies comme du bruit (pas de vrais quartiers)
BRUIT = {
    'rond point', 'echangeur', 'television', 'abatoire', 'bureau du quartier',
    'bureau du', 'regideso', 'cite oms', 'belle vue', 'le concorde', 'donbosco',
    'salongo', 'cimetiere', 'marche central', 'hopital', 'eglise', 'ecole',
    'stade', 'aeroport', 'universite', 'campus', 'camp militaire',
}

# ── Utilitaires ──────────────────────────────────────────────────────────────

def normaliser(s: str) -> str:
    """Minuscules sans accents pour comparaison."""
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.lower().strip()

def est_bruit(nom: str) -> bool:
    n = normaliser(nom)
    return any(b in n for b in BRUIT) or len(nom) < 3

def overpass_query(bbox_str: str, timeout: int = 180) -> list:
    """
    Recupere suburb/neighbourhood/quarter dans la bbox (south,west,north,east).
    3 tentatives avec backoff.
    """
    query = f"""
[out:json][timeout:{timeout}][maxsize:536870912];
(
  node["place"~"suburb|neighbourhood|quarter"]({bbox_str});
  way["place"~"suburb|neighbourhood|quarter"]({bbox_str});
);
out center;
"""
    for attempt in range(1, 4):
        try:
            r = httpx.post(OVERPASS, data={'data': query},
                           headers=HEADERS, timeout=timeout + 30)
            if r.status_code == 200:
                return r.json().get('elements', [])
            print(f"    HTTP {r.status_code} — tentative {attempt}/3")
        except Exception as e:
            print(f"    Erreur reseau : {e} — tentative {attempt}/3")
        time.sleep(15 * attempt)
    return []

# ── Connexion DB ─────────────────────────────────────────────────────────────

conn = psycopg2.connect(DATABASE_URL)
cur  = conn.cursor()

# Provinces avec bbox (rempli par test_import.py depuis les shapefiles)
cur.execute("""
    SELECT pcode, name_fr, bbox
    FROM admin_divisions
    WHERE level = 1 AND is_active = TRUE AND bbox IS NOT NULL
    ORDER BY name_fr
""")
provinces = cur.fetchall()

if not provinces:
    print("Aucune province avec bbox — lancez d'abord test_import.py")
    raise SystemExit(1)

print(f"{len(provinces)} provinces a traiter.\n")

total_insere      = 0
total_deja_la     = 0
total_ignore      = 0
total_non_rattache = 0

for pcode_prov, nom_prov, bbox in provinces:
    # bbox est stocke comme double precision[] : [west, south, east, north]
    if not bbox or len(bbox) < 4:
        print(f"[{nom_prov}] bbox invalide — ignore.")
        continue

    west, south, east, north = bbox[0], bbox[1], bbox[2], bbox[3]
    # Overpass attend (south, west, north, east)
    bbox_str = f"{south:.6f},{west:.6f},{north:.6f},{east:.6f}"

    print(f"[{nom_prov}] ({bbox_str})")
    elements = overpass_query(bbox_str)
    print(f"  {len(elements)} elements OSM bruts.")

    if not elements:
        time.sleep(5)
        continue

    # Quartiers deja presents sous cette province (pour eviter doublons et continuer le compteur)
    cur.execute("""
        SELECT ad4.parent_pcode, ad4.name_fr, ad4.pcode
        FROM admin_divisions ad4
        WHERE ad4.level = 4
          AND ad4.parent_pcode LIKE %s
    """, [pcode_prov + '%'])
    existants = cur.fetchall()

    compteur      = {}   # commune_pcode -> dernier numero Q utilise
    noms_presents = set()  # (commune_pcode, nom_normalise)

    for parent_pcode, nom_ex, q_pcode in existants:
        if nom_ex:
            noms_presents.add((parent_pcode, normaliser(nom_ex)))
        m = re.search(r'Q(\d+)$', q_pcode or '')
        if m:
            compteur[parent_pcode] = max(compteur.get(parent_pcode, 0), int(m.group(1)))

    insere = deja_la = ignore = non_rattache = 0

    for el in elements:
        tags = el.get('tags', {})
        nom  = tags.get('name', '').strip()

        if not nom or est_bruit(nom):
            ignore += 1
            continue

        lat = el.get('lat') or el.get('center', {}).get('lat')
        lon = el.get('lon') or el.get('center', {}).get('lon')
        if lat is None or lon is None:
            ignore += 1
            continue

        # Rattachement par position : commune (niveau 3) qui contient ce point
        cur.execute("""
            SELECT pcode FROM admin_divisions
            WHERE level = 3 AND geometry IS NOT NULL
              AND ST_Contains(geometry, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
            LIMIT 1
        """, [lon, lat])
        res = cur.fetchone()

        if not res:
            non_rattache += 1
            continue

        commune_pcode = res[0]
        key = (commune_pcode, normaliser(nom))

        if key in noms_presents:
            deja_la += 1
            continue

        noms_presents.add(key)
        compteur[commune_pcode] = compteur.get(commune_pcode, 0) + 1
        quartier_pcode = f"{commune_pcode}Q{str(compteur[commune_pcode]).zfill(3)}"

        cur.execute("""
            INSERT INTO admin_divisions
                (pcode, name, name_fr, level, parent_pcode, centroid, is_active)
            VALUES
                (%s, %s, %s, 4, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), true)
            ON CONFLICT (pcode) DO NOTHING
        """, [quartier_pcode, nom, nom, commune_pcode, lon, lat])
        insere += 1

    conn.commit()
    print(f"  -> Inseres: {insere}  Deja presents: {deja_la}  Ignores: {ignore}  Non rattaches: {non_rattache}")

    total_insere       += insere
    total_deja_la      += deja_la
    total_ignore       += ignore
    total_non_rattache += non_rattache

    time.sleep(8)  # rate limit Overpass

# ── Bilan final ──────────────────────────────────────────────────────────────

cur.execute("SELECT COUNT(*) FROM admin_divisions WHERE level = 4")
total_en_base = cur.fetchone()[0]

cur.close()
conn.close()

print(f"""
{'=' * 54}
  BILAN IMPORT QUARTIERS
  Inseres        : {total_insere}
  Deja presents  : {total_deja_la}
  Ignores (bruit): {total_ignore}
  Non rattaches  : {total_non_rattache}
  Total niveau 4 : {total_en_base} divisions en base
{'=' * 54}
""")
