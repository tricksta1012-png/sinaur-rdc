# Carte historique des catastrophes — SINAUR-RDC

## Présentation

La fonctionnalité **Carte historique** permet de visualiser sur une carte interactive les catastrophes passées ayant affecté la République Démocratique du Congo depuis l'an 2000 jusqu'à nos jours.

Elle complète la carte en temps réel (mode par défaut) en ajoutant une mémoire longue des sinistres : volcans, épidémies, inondations, glissements de terrain, conflits et déplacements, sécheresses et crises humanitaires complexes.

---

## Activation du mode historique

Dans la page **Carte nationale des incidents** du backoffice web :

1. Cliquez sur le bouton **🕐 Carte historique** dans la barre d'outils (en haut à droite des filtres).
2. La carte passe en mode historique — le titre affiche le badge _Mode historique_.
3. Un sélecteur de **période** apparaît (toutes périodes / 2020 / 2021 / … / avant 2020).
4. Pour revenir à la vue temps réel, cliquez sur **Quitter historique**.

**Comportement :**
- En mode normal : 500 événements actifs maximum, rafraîchissement toutes les 30 s.
- En mode historique : jusqu'à 2 000 événements (actifs + résolus), pas de rafraîchissement automatique.

---

## Données — sources et couverture

### Sources documentaires

| Source | Type | URL de référence |
|--------|------|-----------------|
| **OCHA ReliefWeb** | Rapports d'urgence, SITREP | reliefweb.int |
| **OMS / WHO** | Épidémies, alertes sanitaires | who.int |
| **FEWS NET** | Insécurité alimentaire, sécheresses | fews.net |
| **USGS** | Séismes, éruptions volcaniques | usgs.gov |
| **HCR / UNHCR** | Déplacements, réfugiés | unhcr.org |
| **UNICEF** | Crises humanitaires, malnutrition | unicef.org |
| **Gouvernement RDC / MSSP** | Données officielles nationales | — |
| **MSF / Médecins Sans Frontières** | Crises médicales sur le terrain | msf.org |

### Couverture thématique (seed initial : 70 événements, 2000-2025)

| Catégorie | Nombre | Exemples notables |
|-----------|--------|-------------------|
| **Éruptions volcaniques** | 4 | Nyiragongo 2002 (147 morts), Nyiragongo 2021 (400 000 déplacés) |
| **Épidémies** | 19 | Ebola 2018-2020 (2 299 morts), Mpox 2024 USPPI, Rougeole 2020 (6 000 morts) |
| **Inondations** | 21 | Kalehe 2023 (430+ morts), Kinshasa 2024 (300+ morts) |
| **Glissements de terrain** | 4 | Nyamukubi 2023 (engloutissement de villages entiers) |
| **Conflits / déplacements** | 10 | M23 2025 (7 millions déplacés), Kasaï 2016-17 (1,4M déplacés) |
| **Déplacements de masse** | 3 | Est-RDC 2023 (6,9 millions de PDI) |
| **Sécheresses / insécurité alim.** | 3 | Grand-Kasaï 2019-20 (6M en crise) |
| **Crises humanitaires complexes** | 3 | RDC 2020 (19,6M dans le besoin) |
| **Autres** (séisme, incendie, etc.) | 3 | Séisme lac Kivu 2008, Virunga 2021 |

### Couverture géographique

Les événements couvrent **26 provinces** de la RDC avec une forte concentration dans :
- **Est du pays** : Nord-Kivu, Sud-Kivu, Ituri, Tanganyika (conflits + aléas naturels + épidémies)
- **Bassin du Congo** : Équateur, Tshopo, Maniema (inondations + épidémies)
- **Kinshasa** : Inondations urbaines récurrentes
- **Grand-Kasaï** : Insécurité alimentaire + conflits post-2016

---

## Structure des données

Chaque événement historique est stocké dans la table `disaster_events` avec les champs suivants :

| Champ | Type | Description |
|-------|------|-------------|
| `id` | UUID | Identifiant fixe (permet la ré-application idempotente du seed) |
| `title` | TEXT | Titre descriptif en français |
| `description` | TEXT | Description détaillée (victimes, contexte, réponse) |
| `hazard_type` | ENUM | Type d'aléa : `flood`, `health_epidemic`, `conflict`, `volcanic_eruption`, `landslide`, `drought`, `fire`, `earthquake`, `mass_displacement`, `humanitarian_crisis`, `other` |
| `status` | ENUM | `active` (en cours / persistant) ou `resolved` (terminé) |
| `severity` | ENUM | `Minor` / `Moderate` / `Severe` / `Extreme` |
| `confidence` | ENUM | `low` / `medium` / `high` / `confirmed` |
| `source` | ENUM | Organisme source (`ocha`, `reliefweb`, `ocha`, `fews_net`, `official`, etc.) |
| `glide_number` | TEXT | Identifiant GLIDE (ex. `FL-2023-000063-COD`) |
| `location_pcode` | TEXT | Code administratif OCHA (ex. `CD14` = Nord-Kivu) |
| `location_point` | GEOMETRY | Coordonnées GPS PostGIS (SRID 4326) |
| `estimated_affected` | INTEGER | Nombre estimé de personnes affectées |
| `start_date` | TIMESTAMPTZ | Date de début de l'événement |
| `end_date` | TIMESTAMPTZ | Date de fin (NULL si encore actif) |
| `tags` | TEXT[] | Mots-clés pour recherche et filtrage |

---

## API

### Endpoint carte normale (événements actifs uniquement)

```
GET /dashboard/map-data
```

Retourne les événements non résolus et non rejetés. Limite : **500 événements**.

### Endpoint carte historique

```
GET /dashboard/map-data?history=true
```

Retourne tous les événements y compris résolus. Limite : **2 000 événements**.

**Réponse JSON :**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "title": "Éruption du Nyiragongo — Goma 2021",
      "hazardType": "volcanic_eruption",
      "status": "resolved",
      "severity": "Extreme",
      "locationPcode": "CD14",
      "locationName": "Goma, Nord-Kivu",
      "estimatedAffected": 400000,
      "glideNumber": "VO-2021-000069-COD",
      "startDate": "2021-05-22T19:58:00Z",
      "endDate": "2021-06-15T00:00:00Z",
      "lng": 29.2333,
      "lat": -1.6833,
      "provinceCount": null
    }
  ]
}
```

---

## Interface utilisateur

### Barre d'outils
- **Filtres par type d'aléa** : Tous / Inondation / Déplacement / Épidémie / Conflit / Autres
- **Filtre par période** *(mode historique uniquement)* : Toutes périodes / 2025 / 2024 / 2023 / ... / Avant 2020
- **Bouton 🕐 Carte historique** : bascule entre mode temps réel et mode historique

### Marqueurs

| Apparence | Signification |
|-----------|--------------|
| Cercle coloré plein, opacité 100 % | Événement **actif** |
| Cercle coloré, opacité 55 % + badge ✓ | Événement **résolu** (historique) |
| Point rouge clignotant | Événement de sévérité **Extreme** actif |
| Cluster orange/rouge | Groupe d'événements (zoom pour dézoner) |

**Couleurs par sévérité :**
- Jaune : Mineure
- Orange : Modérée
- Rouge : Sévère
- Rouge foncé : Extrême

### Popup de détail

Cliquer sur un marqueur affiche :
- **Titre** et localisation (nom + P-code)
- **Badges** : sévérité + statut
- **Dates** : début et fin (si disponible)
- **Personnes affectées** (estimation)
- **Numéro GLIDE** (identifiant humanitaire international)

---

## Ajout de nouveaux événements historiques

### Via le backoffice (interface web)

1. Connectez-vous avec un compte `territory_admin`, `national_decision_maker` ou `system_admin`.
2. Allez dans **Événements** → **Signaler un événement**.
3. Remplissez le formulaire en indiquant une date de début dans le passé.
4. Définissez le statut sur **Résolu** si l'événement est terminé.

### Via le fichier de seed (pour les données historiques en masse)

Le fichier `db/seeds/004_historical_disasters.sql` contient les données initiales. Pour ajouter des événements :

1. Ajoutez un bloc `INSERT` avec un UUID fixe unique :
   ```sql
   (
     'a1b2c3d4-e5f6-4a7b-8c9d-a1b200000071',  -- UUID incrémental
     'Titre de l''événement',
     'Description détaillée...',
     'flood',        -- hazard_type
     'resolved',     -- status
     'Severe',       -- severity
     'high',         -- confidence
     'ocha',         -- source
     'https://reliefweb.int/...',   -- source_url (ou NULL)
     'FL-2024-000XXX-COD',          -- glide_number (ou NULL)
     'CD14',         -- location_pcode (P-code province)
     'Nom du lieu',  -- location_name
     1,              -- location_level (1 = province)
     'city',         -- location_accuracy
     ST_SetSRID(ST_MakePoint(29.2333, -1.6833), 4326),  -- lng, lat
     50000,          -- estimated_affected
     '2024-01-15 00:00:00+00',  -- start_date
     '2024-03-31 00:00:00+00',  -- end_date (NULL si actif)
     ARRAY['tag1','tag2']        -- tags
   )
   ```

2. Re-appliquez le seed (idempotent — les événements existants sont ignorés) :
   ```bash
   pnpm db:seed
   # ou directement :
   psql $DATABASE_URL -f db/seeds/004_historical_disasters.sql
   ```

### Codes P-code des 26 provinces RDC

| P-code | Province |
|--------|----------|
| CD01 | Kinshasa |
| CD02 | Kongo-Central |
| CD03 | Kwango |
| CD04 | Kwilu |
| CD05 | Mai-Ndombe |
| CD06 | Kasaï |
| CD07 | Kasaï-Central |
| CD08 | Kasaï-Oriental |
| CD09 | Lomami |
| CD10 | Sankuru |
| CD11 | Maniema |
| CD12 | Sud-Kivu |
| CD13 | Haut-Katanga |  
| CD14 | Nord-Kivu |
| CD15 | Ituri |
| CD16 | Haut-Uélé |
| CD17 | Tshopo |
| CD18 | Bas-Uélé |
| CD19 | Nord-Ubangi |
| CD20 | Mongala |
| CD21 | Sud-Ubangi |
| CD22 | Équateur |
| CD23 | Tshuapa |
| CD24 | Tanganyika |
| CD25 | Haut-Lomami |
| CD26 | Lualaba |

---

## Limites et précisions

- **Coordonnées** : Les points représentent le chef-lieu ou l'épicentre de l'événement, pas nécessairement la zone exacte d'impact (qui peut couvrir plusieurs provinces).
- **Chiffres de victimes** : Les estimations proviennent de sources humanitaires et peuvent différer des bilans officiels, notamment pour les conflits armés (sous-déclaration fréquente).
- **Événements actifs** : Les crises toujours en cours en 2025 (M23, Mpox, crue du Congo, crise alimentaire) ont `end_date = NULL` et `status = 'active'`.
- **Couverture temporelle** : Le seed couvre principalement 2000-2025. Des événements antérieurs (ex. guerres du Congo 1996-2002) peuvent être ajoutés ultérieurement.
- **Dédoublonnage** : Certains événements multi-aléas (ex. Kalehe mai 2023 = inondation + glissement) apparaissent en deux entrées distinctes pour permettre le filtrage par type.

---

## Évolutions prévues

- [ ] Import automatique depuis ReliefWeb API (événements historiques)
- [ ] Import depuis EM-DAT (Emergency Events Database)
- [ ] Filtrage spatial par province (clic sur la carte)
- [ ] Heatmap densité temporelle par décennie
- [ ] Export GeoJSON / KML de la sélection historique
- [ ] Timeline animée (défilement chronologique des événements)
