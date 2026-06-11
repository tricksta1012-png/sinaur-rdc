"""
Référentiel des acteurs armés actifs en RDC.
Source : ACLED, OCHA, rapports publics MONUSCO, ICG (International Crisis Group).
Usage : humanitaire uniquement — anticipation des déplacements de populations civiles.
Classification : RESTRICTED
"""
from __future__ import annotations

ARMED_ACTORS_RDC: list[dict] = [
    {
        "nom_acled": "M23/AFC",
        "nom_alternatifs": [
            "Mouvement du 23 Mars",
            "Alliance Fleuve Congo",
            "AFC/M23",
            "M23",
        ],
        "categorie": "groupe_arme_non_etatique",
        "provinces_actives_historique": ["Nord-Kivu"],
        "provinces_a_risque_expansion": ["Sud-Kivu", "Ituri"],
        "type_violence_frequent": "Battles, Strategic developments, Violence against civilians",
        "corridors_deplacement_associes": [
            ("Rutshuru",   "Goma",    "Sake"),
            ("Masisi",     "Goma",    "Minova"),
            ("Nyiragongo", "Goma",    "Sake"),
            ("Lubero",     "Butembo", "Goma"),
        ],
        "facteur_amplification_deplacement": 1.35,
        "note_humanitaire": (
            "Groupe associé aux plus grands flux de déplacement du Nord-Kivu "
            "depuis 2021. L'avance vers Goma en 2025 a généré plus de 500 000 "
            "déplacés selon IOM DTM."
        ),
    },
    {
        "nom_acled": "FDLR-FOCA",
        "nom_alternatifs": [
            "Forces Démocratiques de Libération du Rwanda",
            "FDLR",
            "FOCA",
        ],
        "categorie": "groupe_arme_non_etatique",
        "provinces_actives_historique": ["Nord-Kivu", "Sud-Kivu", "Maniema"],
        "provinces_a_risque_expansion": ["Tanganyika"],
        "type_violence_frequent": "Violence against civilians, Battles",
        "corridors_deplacement_associes": [
            ("Walikale", "Goma",   "Bukavu"),
            ("Kalehe",   "Bukavu", "Uvira"),
            ("Shabunda", "Bukavu", "Kindu"),
        ],
        "facteur_amplification_deplacement": 1.20,
        "note_humanitaire": (
            "Présence ancienne dans les Kivus. "
            "Déplacements souvent liés à des opérations militaires FARDC dans la zone."
        ),
    },
    {
        "nom_acled": "ADF",
        "nom_alternatifs": [
            "Allied Democratic Forces",
            "Forces Démocratiques Alliées",
            "ADF-NALU",
        ],
        "categorie": "groupe_arme_non_etatique",
        "provinces_actives_historique": ["Nord-Kivu", "Ituri"],
        "provinces_a_risque_expansion": ["Maniema", "Tshopo"],
        "type_violence_frequent": "Violence against civilians, Explosions/Remote violence",
        "corridors_deplacement_associes": [
            ("Beni",    "Beni ville", "Butembo"),
            ("Irumu",   "Bunia",      "Beni ville"),
            ("Mambasa", "Bunia",      "Butembo"),
        ],
        "facteur_amplification_deplacement": 1.45,
        "note_humanitaire": (
            "Groupe avec le taux de violence contre civils le plus élevé "
            "selon ACLED. Déplacements nocturnes fréquents. "
            "Présence documentée en Ituri et Beni depuis 1995."
        ),
    },
    {
        "nom_acled": "CODECO",
        "nom_alternatifs": ["Coopérative pour le Développement du Congo"],
        "categorie": "milice_communautaire",
        "provinces_actives_historique": ["Ituri"],
        "provinces_a_risque_expansion": ["Nord-Kivu"],
        "type_violence_frequent": "Violence against civilians, Battles",
        "corridors_deplacement_associes": [
            ("Djugu",  "Bunia", "Rethy"),
            ("Mahagi", "Bunia", "Aru"),
        ],
        "facteur_amplification_deplacement": 1.25,
        "note_humanitaire": (
            "Milice à base ethnique Lendu active en Ituri. "
            "Pic d'activité documenté entre 2019 et 2021 — "
            "surveillance continue requise."
        ),
    },
    {
        "nom_acled": "Twirwaneho",
        "nom_alternatifs": ["Forces de Résistance pour la Défense"],
        "categorie": "milice_communautaire",
        "provinces_actives_historique": ["Sud-Kivu"],
        "provinces_a_risque_expansion": ["Maniema"],
        "type_violence_frequent": "Battles, Violence against civilians",
        "corridors_deplacement_associes": [
            ("Fizi",   "Uvira",  "Baraka"),
            ("Mwenga", "Bukavu", "Baraka"),
        ],
        "facteur_amplification_deplacement": 1.15,
        "note_humanitaire": (
            "Milice Banyamulenge active dans les hauts plateaux du Sud-Kivu. "
            "Conflits souvent intercommunautaires."
        ),
    },
    {
        "nom_acled": "Mai-Mai Mazembe",
        "nom_alternatifs": ["Maï-Maï Mazembe"],
        "categorie": "milice_communautaire",
        "provinces_actives_historique": ["Tanganyika"],
        "provinces_a_risque_expansion": ["Haut-Katanga", "Lomami"],
        "type_violence_frequent": "Violence against civilians, Battles",
        "corridors_deplacement_associes": [
            ("Kalemie", "Kalemie ville", "Kabalo"),
            ("Nyunzu",  "Kalemie ville", "Kongolo"),
        ],
        "facteur_amplification_deplacement": 1.10,
        "note_humanitaire": (
            "Active dans le Tanganyika, souvent en opposition aux FARDC. "
            "Déplacements vers les rives du lac Tanganyika."
        ),
    },
    {
        "nom_acled": "Kamwina Nsapu",
        "nom_alternatifs": ["Milice Kamwina Nsapu"],
        "categorie": "milice_communautaire",
        "provinces_actives_historique": ["Kasaï", "Kasaï-Central", "Kasaï-Oriental"],
        "provinces_a_risque_expansion": ["Lomami", "Sankuru"],
        "type_violence_frequent": "Violence against civilians, Battles",
        "corridors_deplacement_associes": [
            ("Kamonia", "Tshikapa", "Kananga"),
            ("Luebo",   "Kananga",  "Mbuji-Mayi"),
        ],
        "facteur_amplification_deplacement": 1.20,
        "note_humanitaire": (
            "Crise du Kasaï 2016–2018 : plus de 1,4 million de déplacés. "
            "Surveillance maintenue sur les signaux de résurgence."
        ),
    },
    {
        "nom_acled": "FARDC",
        "nom_alternatifs": [
            "Forces Armées de la République Démocratique du Congo",
        ],
        "categorie": "forces_gouvernementales",
        "provinces_actives_historique": [
            "Nord-Kivu", "Sud-Kivu", "Ituri",
            "Tanganyika", "Maniema", "Kasaï",
        ],
        "provinces_a_risque_expansion": [],
        "type_violence_frequent": "Battles, Strategic developments",
        "corridors_deplacement_associes": [],
        "facteur_amplification_deplacement": 1.00,
        "note_humanitaire": (
            "Forces nationales. Les opérations militaires peuvent générer "
            "des déplacements temporaires dans les zones de combat. "
            "Traçage des mouvements pour coordination humanitaire uniquement."
        ),
    },
]

# Index rapide par nom ACLED
ACTORS_BY_ACLED_NAME: dict[str, dict] = {
    a["nom_acled"]: a for a in ARMED_ACTORS_RDC
}

# Index par alias (tous alias + nom ACLED, en majuscules pour matching insensible)
ACTORS_BY_ALIAS: dict[str, dict] = {}
for _actor in ARMED_ACTORS_RDC:
    for _alias in _actor["nom_alternatifs"] + [_actor["nom_acled"]]:
        ACTORS_BY_ALIAS[_alias.upper()] = _actor
