"""
Fiches initiales de la bibliothèque RAG.
Synthèses factuelles sur les principaux groupes armés et dynamiques humanitaires
de la RDC, basées sur des sources publiques (ONU, ICG, KST, OCHA, HRW).
"""
from __future__ import annotations

FICHES_INITIALES = [
    {
        "titre": "Fiche synthèse — M23 (Mouvement du 23 Mars)",
        "type_document": "FICHE_GROUPE",
        "source": "SINAUR-synthèse (ICG/ONU/KST)",
        "date_publication": "2025-01-01",
        "fiabilite": 0.85,
        "themes": ["M23", "Nord-Kivu", "Rutshuru", "Masisi", "Goma", "Rwanda", "AFC"],
        "texte": (
            "Le M23 (Mouvement du 23 Mars) est un groupe armé principalement composé de Tutsi congolais, "
            "actif dans l'Est de la RDC depuis 2012. Il tire son nom d'un accord de paix du 23 mars 2009 "
            "qu'il juge non respecté.\n\n"
            "ZONES D'OPÉRATION : Nord-Kivu, territoires de Rutshuru et Masisi. Depuis janvier 2025, le M23 "
            "contrôle Goma (chef-lieu du Nord-Kivu) et poursuit vers le Sud-Kivu. Axes stratégiques : "
            "RN2 (Goma-Rutshuru-Bunagana), postes frontaliers avec l'Ouganda et le Rwanda.\n\n"
            "SOUTIEN EXTÉRIEUR : Le Groupe d'experts de l'ONU a documenté un soutien militaire du Rwanda "
            "(RDF), incluant des troupes, de l'artillerie et des drones. Ce soutien est motivé par des "
            "intérêts sécuritaires (FDLR) et économiques (minerais). Le M23 se présente politiquement "
            "via l'AFC (Alliance Fleuve Congo), porte-parole Bertrand Bisimwa.\n\n"
            "IMPACTS HUMANITAIRES : Les offensives M23 ont provoqué les plus grandes vagues de déplacements "
            "de l'histoire récente de la RDC. Axes de fuite principaux : vers le sud (Sake, Minova, "
            "Bunyakiri, Kalehe), vers l'ouest (Walikale), vers l'Ouganda (Kasindi). Après la chute de Goma, "
            "des centaines de milliers de personnes ont fui vers le Sud-Kivu.\n\n"
            "DYNAMIQUES 2024-2025 : Après l'avancée de 2024, prise de Goma en janvier 2025, puis poussée "
            "vers Bukavu. Négociations à Luanda et Nairobi sans cessez-le-feu durable. SADC/SAMIDRC "
            "déployée mais avec impact limité."
        ),
    },
    {
        "titre": "Fiche synthèse — ADF (Allied Democratic Forces)",
        "type_document": "FICHE_GROUPE",
        "source": "SINAUR-synthèse (ONU/MONUSCO/KST)",
        "date_publication": "2024-06-01",
        "fiabilite": 0.85,
        "themes": ["ADF", "Ituri", "Nord-Kivu", "Beni", "terrorisme", "Islam", "ISIS"],
        "texte": (
            "Les ADF (Allied Democratic Forces) sont un groupe armé d'origine ougandaise actif dans "
            "le territoire de Beni (Nord-Kivu) et l'Ituri. Reconnus comme menace terroriste par l'ONU "
            "en 2017, ils ont des liens documentés avec Daech depuis 2019.\n\n"
            "ZONES D'OPÉRATION : Forêts à cheval sur la frontière RDC-Ouganda, territoires de Beni "
            "(Nord-Kivu) et Irumu/Mambasa (Ituri). Axes perturbés : Beni-Komanda, Beni-Eringeti.\n\n"
            "MODES D'ACTION : Massacres de civils (villages brûlés), enlèvements, mines artisanales "
            "et IED, embuscades nocturnes. Ils évitent les confrontations directes, privilégient la "
            "guérilla forestière.\n\n"
            "IMPACTS HUMANITAIRES : Plus de 6 000 morts civils documentés depuis 2014 (KST). "
            "Déplacements vers Beni, Butembo, Kasese (Ouganda). Perturbation grave de l'accès humanitaire.\n\n"
            "OPÉRATIONS MILITAIRES : Opérations conjointes FARDC-UPDF (armée ougandaise) depuis 2021 "
            "ont perturbé certaines bases mais n'ont pas éliminé la menace. Les ADF se régénèrent "
            "dans les zones forestières inaccessibles."
        ),
    },
    {
        "titre": "Fiche synthèse — CODECO (milices Lendu, Ituri)",
        "type_document": "FICHE_GROUPE",
        "source": "SINAUR-synthèse (HRW/ONU/Ebuteli)",
        "date_publication": "2024-03-01",
        "fiabilite": 0.80,
        "themes": ["CODECO", "Ituri", "Djugu", "Lendu", "Hema", "conflit intercommunautaire"],
        "texte": (
            "CODECO désigne plusieurs milices à dominance Lendu actives dans le territoire de Djugu "
            "(Ituri), nées d'un conflit intercommunautaire avec les Hema en 2017-2018.\n\n"
            "ZONES D'OPÉRATION : Quasi-exclusivement territoire de Djugu (Ituri), zones lacustres "
            "du lac Albert, axe Djugu-Mahagi-Bunia.\n\n"
            "NATURE : Les Nations Unies et HRW ont documenté des massacres délibérés de civils Hema, "
            "villages brûlés et pillages. Structure éclatée autour de 'prophètes' traditionnels, "
            "ce qui rend les négociations très difficiles.\n\n"
            "IMPACTS HUMANITAIRES : Plus de 1 500 morts documentés et 1,7 million de déplacés en Ituri "
            "(2018-2023). Déplacements vers Bunia, camps autour du lac Albert, et Ouganda. "
            "Le retour est quasi-impossible pour de nombreux déplacés Hema.\n\n"
            "DYNAMIQUES : Malgré des opérations FARDC, les violences cycliques persistent. "
            "Les tentatives de dialogue intercommunautaire ont des résultats très limités."
        ),
    },
    {
        "titre": "Fiche synthèse — FDLR (Forces Démocratiques de Libération du Rwanda)",
        "type_document": "FICHE_GROUPE",
        "source": "SINAUR-synthèse (ONU/ICG)",
        "date_publication": "2024-01-01",
        "fiabilite": 0.82,
        "themes": ["FDLR", "Sud-Kivu", "Nord-Kivu", "Rwanda", "Hutu", "génocide"],
        "texte": (
            "Les FDLR sont un groupe armé composé de Hutu rwandais, dont des participants au génocide "
            "de 1994 et leurs descendants, réfugiés en RDC depuis plus de 30 ans.\n\n"
            "ZONES D'OPÉRATION : Sud-Kivu (Shabunda, Mwenga, Fizi, Uvira, Hauts-Plateaux) et "
            "Nord-Kivu (Walikale, Masisi, Lubero). Présents dans les zones forestières difficiles "
            "d'accès, souvent aux frontières avec le Rwanda et le Burundi.\n\n"
            "DYNAMIQUES : Leur présence est utilisée par le Rwanda pour justifier son soutien au M23. "
            "Les FDLR ont des alliances tactiques variables avec les FARDC (contre le M23) et des "
            "Mai-Mai. Ils contrôlent des zones minières (or, coltan dans Shabunda et Walikale).\n\n"
            "IMPACTS HUMANITAIRES : Violences contre civils, notamment dans les Hauts-Plateaux du "
            "Sud-Kivu (Minembwe, Fizi). Rapatriement volontaire au Rwanda proposé mais très peu suivi. "
            "Les déplacés des Hauts-Plateaux fuient vers Uvira et Baraka."
        ),
    },
    {
        "titre": "Fiche synthèse — Wazalendo (milices pro-gouvernementales Est-RDC)",
        "type_document": "FICHE_GROUPE",
        "source": "SINAUR-synthèse (KST/Ebuteli)",
        "date_publication": "2025-01-01",
        "fiabilite": 0.78,
        "themes": ["Wazalendo", "Nord-Kivu", "Sud-Kivu", "FARDC", "MAI-MAI", "patriotes"],
        "texte": (
            "Les Wazalendo ('patriotes' en swahili) désignent une coalition de milices d'autodéfense "
            "locales alliées aux FARDC pour combattre le M23 dans l'Est de la RDC.\n\n"
            "NATURE : Coalition hétérogène de groupes Mai-Mai et d'autodéfense (Hunde, Nande, Tembo). "
            "Terme apparu massivement en 2022-2023. Structure décentralisée.\n\n"
            "ZONES : Nord-Kivu (Masisi, Rutshuru, Walikale) et Sud-Kivu (Kalehe, Shabunda). "
            "Opèrent dans les zones rurales forestières inaccessibles aux FARDC.\n\n"
            "RISQUES : Malgré l'alignement pro-gouvernemental, des violations des droits humains "
            "sont documentées (pillages, exactions). Leur intégration dans les FARDC pose des défis "
            "de commandement et de discipline.\n\n"
            "DYNAMIQUES 2025 : Après la chute de Goma, certains Wazalendo maintiennent des résistances "
            "locales dans les zones rurales du Nord-Kivu. Tensions parfois avec les FARDC sur les "
            "questions de commandement et de ressources."
        ),
    },
    {
        "titre": "Fiche synthèse — Mobondo (milice Yaka, Kwilu / Maï-Ndombe)",
        "type_document": "FICHE_GROUPE",
        "source": "SINAUR-synthèse (Ebuteli/GEC)",
        "date_publication": "2024-01-01",
        "fiabilite": 0.75,
        "themes": ["Mobondo", "Kwilu", "Maï-Ndombe", "Yaka", "Teke", "Kwamouth", "Bandundu"],
        "texte": (
            "Mobondo est une milice d'autodéfense Yaka active dans les provinces de Kwilu, "
            "Maï-Ndombe et Bandundu Ville, impliquée dans des violences intercommunautaires avec les Teke.\n\n"
            "ZONES D'OPÉRATION : Territoires de Kwamouth (Maï-Ndombe) et Bagata (Kwilu), zones rurales "
            "entre Kinshasa et Bandundu. La ville de Bandundu est parfois menacée.\n\n"
            "ORIGINE : Différend ancien Yaka-Teke sur les droits fonciers et pastoraux. Milice Mobondo "
            "émergée comme force d'autodéfense Yaka après des incidents en 2022. Utilise des armes "
            "artisanales et des pratiques de médecine traditionnelle.\n\n"
            "IMPACTS : Des dizaines de milliers de déplacés, principalement des Teke fuyant vers "
            "Kwamouth, Bandundu et Kinshasa. Accès humanitaire très difficile dans ces zones enclavées.\n\n"
            "DYNAMIQUES : Structure décentralisée et motivations foncières profondes rendent "
            "les négociations difficiles. Les opérations FARDC ont un effet limité en zone de brousse."
        ),
    },
    {
        "titre": "Dynamiques de déplacement en RDC — axes et patterns",
        "type_document": "ANALYSE",
        "source": "SINAUR-synthèse (OCHA/UNHCR/IOM)",
        "date_publication": "2025-01-01",
        "fiabilite": 0.88,
        "themes": ["déplacement", "IDP", "axes", "Nord-Kivu", "Sud-Kivu", "Ituri", "humanitaire"],
        "texte": (
            "La RDC compte environ 7 millions de déplacés internes (IDPs) en 2024-2025 (OCHA/UNHCR), "
            "l'une des crises de déplacement les plus importantes du monde.\n\n"
            "NORD-KIVU — Axes de fuite principaux :\n"
            "- Rutshuru/Bunagana → Goma (avant chute) → Minova/Sake (après chute)\n"
            "- Masisi → Goma (RN2) / → Walikale / → Sake\n"
            "- Goma → Minova → Bunyakiri → Kalehe (fuite vers Sud-Kivu après janvier 2025)\n"
            "- Goma → Rwanda (Kibuye) / Ouganda (Kasindi)\n"
            "- Beni → Butembo → Lubero (fuite des zones ADF)\n"
            "Camps principaux : Mugunga, Kanyaruchinya, zones lacustres du lac Kivu.\n\n"
            "SUD-KIVU — Axes de fuite principaux :\n"
            "- Uvira/Fizi → Bukavu (axe lac Tanganyika)\n"
            "- Shabunda → Bukavu (axe difficile, souvent à pied)\n"
            "- Minembwe/Hauts-Plateaux → Uvira / Baraka\n"
            "- Kalehe → Bukavu (accueil de réfugiés du Nord-Kivu)\n\n"
            "ITURI — Axes de fuite principaux :\n"
            "- Djugu → Bunia / → Mahagi → Ouganda (Arua)\n"
            "- Irumu/Mambasa → Bunia / → Komanda\n"
            "Camps : lac Albert (Rhoe, Lalo).\n\n"
            "FACTEURS DÉCLENCHEURS :\n"
            "- Attaque armée : déplacement immédiat nocturne vers zones perçues sûres\n"
            "- Rumeur d'attaque : déplacement préventif\n"
            "- Tensions intercommunautaires : déplacement ethniquement segmenté\n"
            "- Opérations militaires : déplacements parfois provoqués par les FARDC\n\n"
            "CORRIDORS HUMANITAIRES PRINCIPAUX : RN2 (Goma-Rutshuru), RN4 (Goma-Beni-Bunia), "
            "lac Kivu (Goma-Bukavu par voie lacustre).\n\n"
            "RETOUR : La majorité des IDPs restent déplacés pendant des années. "
            "Le retour dépend de la sécurité perçue, pas nécessairement réelle."
        ),
    },
    {
        "titre": "Contexte géopolitique — acteurs régionaux et minerais",
        "type_document": "ANALYSE",
        "source": "SINAUR-synthèse (ICG/ONU)",
        "date_publication": "2025-01-01",
        "fiabilite": 0.82,
        "themes": ["géopolitique", "Rwanda", "Ouganda", "Burundi", "SADC", "minerais", "M23"],
        "texte": (
            "ACTEURS RÉGIONAUX EN RDC\n\n"
            "RWANDA : Soutien documenté au M23 (Groupe d'experts ONU). Motivations : sécuritaires "
            "(présence FDLR) et économiques (minerais — or et coltan transitant par le Rwanda). "
            "Tensions RDC-Rwanda sont au cœur de l'instabilité de l'Est.\n\n"
            "OUGANDA : Relations plus nuancées. Coopération militaire FARDC-UPDF contre les ADF "
            "(opérations depuis 2021). Intérêts commerciaux importants via Bunagana et Kasindi.\n\n"
            "BURUNDI : Positionné contre le M23. Des troupes burundaises (FNB) présentes en RDC "
            "dans le cadre des mécanismes régionaux. Des groupes armés burundais opèrent parfois en RDC.\n\n"
            "MISSIONS RÉGIONALES :\n"
            "- SADC/SAMIDRC : déployée début 2024 (troupes sud-africaines, tanzaniennes, malawites). "
            "Mandat robuste mais moyens limités. Pertes importantes subies.\n"
            "- EAC-RCI : retirée progressivement après non-engagement contre le M23.\n"
            "- MONUSCO : en cours de retrait depuis 2022-2023.\n\n"
            "MINERAIS : L'Est de la RDC est riche en : or (Ituri, Nord-Kivu), coltan/tantalite "
            "(Kivu, Maniema), cassitérite (Kivu), diamants (Kasaï, Maniema). Le contrôle des sites "
            "miniers et des axes d'exportation est un facteur majeur de tous les conflits. "
            "Les minerais de conflit transitent souvent via Rwanda et Ouganda."
        ),
    },
]


async def charger_fiches_initiales() -> None:
    """À appeler au démarrage si la bibliothèque documentaire est vide."""
    from sqlalchemy import text
    from db import engine
    from .rag_indexeur import indexeur_rag

    async with engine.connect() as conn:
        row = await conn.execute(text("SELECT COUNT(*) FROM kb_document"))
        count = row.scalar()

    if count and count > 0:
        logger = __import__("structlog").get_logger(__name__)
        logger.info("Fiches RAG déjà présentes", count=count)
        return

    logger = __import__("structlog").get_logger(__name__)
    logger.info("Chargement des fiches RAG initiales", nb=len(FICHES_INITIALES))

    for fiche in FICHES_INITIALES:
        try:
            doc_id = await indexeur_rag.indexer_document(
                titre=fiche["titre"],
                type_document=fiche["type_document"],
                source=fiche["source"],
                texte=fiche["texte"],
                date_publication=fiche["date_publication"],
                fiabilite=fiche["fiabilite"],
                themes=fiche["themes"],
                ajoute_par="system",
            )
            logger.info("Fiche RAG indexée", doc_id=doc_id, titre=fiche["titre"])
        except Exception as e:
            logger.error("Erreur indexation fiche RAG", titre=fiche["titre"], error=str(e))
