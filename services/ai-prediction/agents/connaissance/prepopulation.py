"""
Pré-population de la base de connaissance avec les acteurs connus.

Exécuté une seule fois au démarrage si kb_entite est vide.
Sources : armed_actors_rdc.py (ACLED/OCHA/MONUSCO), référentiel interne SINAUR.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import structlog
from sqlalchemy import text

from db import engine

logger = structlog.get_logger(__name__)

# Acteurs à pré-charger avec leurs attributs complets
ACTEURS_INITIAUX = [
    # Groupes armés (from armed_actors_rdc.py)
    {
        "type": "GROUPE_ARME", "nom": "M23/AFC",
        "alternatifs": ["Mouvement du 23 Mars", "Alliance Fleuve Congo", "AFC/M23", "M23"],
        "description": "Coalition armée active au Nord-Kivu. Avance majeure vers Goma en 2025, plus de 500 000 déplacés selon IOM DTM.",
        "confiance": 0.95, "statut": "ETABLI",
        "attributs": {"provinces": ["Nord-Kivu"], "expansion": ["Sud-Kivu", "Ituri"],
                      "facteur_deplacement": 1.35, "categorie": "groupe_arme_non_etatique"},
    },
    {
        "type": "GROUPE_ARME", "nom": "FDLR-FOCA",
        "alternatifs": ["Forces Démocratiques de Libération du Rwanda", "FDLR", "FOCA"],
        "description": "Groupe armé rwandais actif dans les Kivus depuis les années 1990. Déplacements liés aux opérations FARDC.",
        "confiance": 0.95, "statut": "ETABLI",
        "attributs": {"provinces": ["Nord-Kivu", "Sud-Kivu", "Maniema"],
                      "expansion": ["Tanganyika"], "facteur_deplacement": 1.20,
                      "categorie": "groupe_arme_non_etatique"},
    },
    {
        "type": "GROUPE_ARME", "nom": "ADF",
        "alternatifs": ["Allied Democratic Forces", "Forces Démocratiques Alliées", "ADF-NALU"],
        "description": "Groupe armé ougandais, taux de violence contre civils le plus élevé selon ACLED. Présent à Beni et Ituri.",
        "confiance": 0.95, "statut": "ETABLI",
        "attributs": {"provinces": ["Nord-Kivu", "Ituri"],
                      "expansion": ["Maniema", "Tshopo"], "facteur_deplacement": 1.45,
                      "categorie": "groupe_arme_non_etatique"},
    },
    {
        "type": "GROUPE_ARME", "nom": "CODECO",
        "alternatifs": ["Coopérative pour le Développement du Congo"],
        "description": "Milice à base ethnique Lendu active en Ituri (territoire de Djugu). Pic d'activité 2019-2021.",
        "confiance": 0.90, "statut": "ETABLI",
        "attributs": {"provinces": ["Ituri"], "expansion": ["Nord-Kivu"],
                      "facteur_deplacement": 1.25, "categorie": "milice_communautaire"},
    },
    {
        "type": "GROUPE_ARME", "nom": "Twirwaneho",
        "alternatifs": ["Forces de Résistance pour la Défense"],
        "description": "Milice Banyamulenge dans les hauts plateaux du Sud-Kivu. Conflits intercommunautaires fréquents.",
        "confiance": 0.90, "statut": "ETABLI",
        "attributs": {"provinces": ["Sud-Kivu"], "expansion": ["Maniema"],
                      "facteur_deplacement": 1.15, "categorie": "milice_communautaire"},
    },
    {
        "type": "GROUPE_ARME", "nom": "Mai-Mai Mazembe",
        "alternatifs": ["Maï-Maï Mazembe"],
        "description": "Milice communautaire active dans le Tanganyika, souvent en opposition aux FARDC.",
        "confiance": 0.85, "statut": "ETABLI",
        "attributs": {"provinces": ["Tanganyika"],
                      "expansion": ["Haut-Katanga", "Lomami"],
                      "facteur_deplacement": 1.10, "categorie": "milice_communautaire"},
    },
    {
        "type": "GROUPE_ARME", "nom": "Kamwina Nsapu",
        "alternatifs": ["Milice Kamwina Nsapu"],
        "description": "Milice du Kasaï responsable de la crise 2016-2018 (1,4M déplacés). Surveillance pour risques de résurgence.",
        "confiance": 0.90, "statut": "ETABLI",
        "attributs": {"provinces": ["Kasaï", "Kasaï-Central", "Kasaï-Oriental"],
                      "expansion": ["Lomami", "Sankuru"],
                      "facteur_deplacement": 1.20, "categorie": "milice_communautaire"},
    },
    {
        "type": "GROUPE_ARME", "nom": "FARDC",
        "alternatifs": ["Forces Armées de la République Démocratique du Congo"],
        "description": "Forces armées nationales congolaises. Présentes dans toutes les zones de conflit.",
        "confiance": 0.99, "statut": "ETABLI",
        "attributs": {"provinces": ["Nord-Kivu", "Sud-Kivu", "Ituri", "Tanganyika"],
                      "facteur_deplacement": 1.00, "categorie": "forces_gouvernementales"},
    },
    {
        "type": "GROUPE_ARME", "nom": "Wazalendo",
        "alternatifs": ["Milice Wazalendo", "Patriotes Wazalendo"],
        "description": "Coalition de milices pro-gouvernementales soutenant les FARDC au Nord-Kivu contre le M23.",
        "confiance": 0.88, "statut": "ETABLI",
        "attributs": {"provinces": ["Nord-Kivu"], "categorie": "milice_pro_gouvernementale"},
    },
    {
        "type": "GROUPE_ARME", "nom": "APCLS",
        "alternatifs": ["Alliance des Patriotes pour un Congo Libre et Souverain"],
        "description": "Groupe armé actif dans le territoire de Masisi (Nord-Kivu), à dominante Hunde.",
        "confiance": 0.85, "statut": "ETABLI",
        "attributs": {"provinces": ["Nord-Kivu"], "territoire": "Masisi",
                      "categorie": "groupe_arme_non_etatique"},
    },
    {
        "type": "GROUPE_ARME", "nom": "Mobondo",
        "alternatifs": ["Mouvement Mobondo"],
        "description": "Milice issue du conflit intercommunautaire Teke-Yaka, active dans le Maï-Ndombe et Kwamouth.",
        "confiance": 0.85, "statut": "ETABLI",
        "attributs": {"provinces": ["Maï-Ndombe", "Kongo-Central"],
                      "territoire": "Kwamouth", "categorie": "milice_communautaire"},
    },
    # Lieux stratégiques
    {
        "type": "LIEU", "nom": "Goma",
        "alternatifs": [],
        "description": "Chef-lieu du Nord-Kivu. Nœud humanitaire et stratégique majeur à l'Est de la RDC.",
        "confiance": 0.99, "statut": "ETABLI",
        "attributs": {"province": "Nord-Kivu", "pcode": "CD61"},
    },
    {
        "type": "LIEU", "nom": "Beni",
        "alternatifs": ["Territoire de Beni"],
        "description": "Territoire du Nord-Kivu, épicentre de la violence ADF depuis 2014.",
        "confiance": 0.99, "statut": "ETABLI",
        "attributs": {"province": "Nord-Kivu", "pcode": "CD61"},
    },
    {
        "type": "LIEU", "nom": "Bunia",
        "alternatifs": [],
        "description": "Chef-lieu de l'Ituri. Zone de tension intercommunautaire (CODECO, FPIC).",
        "confiance": 0.99, "statut": "ETABLI",
        "attributs": {"province": "Ituri", "pcode": "CD54"},
    },
]

# Relations connues entre acteurs
RELATIONS_INITIALES = [
    ("M23/AFC", "AFFRONTE", "FARDC", "Conflit armé actif au Nord-Kivu", 0.99),
    ("M23/AFC", "AFFRONTE", "Wazalendo", "Combat contre les milices pro-gouvernementales", 0.95),
    ("M23/AFC", "AFFRONTE", "FDLR-FOCA", "Hostilité documentée au Nord-Kivu", 0.85),
    ("Wazalendo", "ALLIE_DE", "FARDC", "Coalition pro-gouvernementale soutenant les FARDC", 0.95),
    ("FDLR-FOCA", "RIVAL_DE", "M23/AFC", "Opposition armée historique", 0.90),
    ("ADF", "OPERE_DANS", "Beni", "Épicentre ADF depuis 2014", 0.99),
    ("CODECO", "OPERE_DANS", "Bunia", "Milice basée en territoire de Djugu, Ituri", 0.95),
    ("M23/AFC", "OPERE_DANS", "Goma", "Prise et contrôle partiel de Goma en 2025", 0.98),
    ("APCLS", "OPERE_DANS", "Goma", "Présence dans le Masisi, proche de Goma", 0.80),
]


async def prepopuler() -> int:
    """Pré-remplit kb_entite si vide. Retourne le nombre d'entités insérées."""
    async with engine.begin() as conn:
        count = (await conn.execute(text("SELECT COUNT(*) FROM kb_entite"))).scalar()
        if count and count > 0:
            logger.info("prepopulation.skip", existing=count)
            return 0

        source_json_base = json.dumps([{"nom": "SINAUR-RDC/référentiel-interne", "date": datetime.now(timezone.utc).isoformat()}])
        inserted = 0
        nom_to_id: dict[str, int] = {}

        for ent in ACTEURS_INITIAUX:
            res = await conn.execute(
                text("""
                    INSERT INTO kb_entite
                        (type_entite, nom, noms_alternatifs, description,
                         niveau_confiance, statut_connaissance, nb_mentions,
                         sources, attributs)
                    VALUES
                        (:type, :nom, :alts, :desc, :conf, :statut, 3,
                         CAST(:srcs AS jsonb), CAST(:attrs AS jsonb))
                    RETURNING id
                """),
                {
                    "type":   ent["type"],
                    "nom":    ent["nom"],
                    "alts":   ent.get("alternatifs", []),
                    "desc":   ent.get("description", ""),
                    "conf":   ent["confiance"],
                    "statut": ent["statut"],
                    "srcs":   source_json_base,
                    "attrs":  json.dumps(ent.get("attributs", {})),
                },
            )
            eid = res.fetchone()[0]
            nom_to_id[ent["nom"]] = eid
            for alt in ent.get("alternatifs", []):
                nom_to_id[alt] = eid
            inserted += 1

        # Relations initiales
        for src_nom, type_rel, cible_nom, detail, conf in RELATIONS_INITIALES:
            sid = nom_to_id.get(src_nom)
            cid = nom_to_id.get(cible_nom)
            if sid and cid and sid != cid:
                await conn.execute(
                    text("""
                        INSERT INTO kb_relation
                            (source_id, cible_id, type_relation, niveau_confiance, sources)
                        VALUES (:sid, :cid, :type, :conf, CAST(:srcs AS jsonb))
                        ON CONFLICT (source_id, cible_id, type_relation) DO NOTHING
                    """),
                    {
                        "sid":  sid, "cid": cid, "type": type_rel,
                        "conf": conf, "srcs": source_json_base,
                    },
                )

        logger.info("prepopulation.done", entites=inserted, relations=len(RELATIONS_INITIALES))
        return inserted
