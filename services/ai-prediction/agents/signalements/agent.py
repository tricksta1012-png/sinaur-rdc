"""
SignalementsAgent — classifie et priorise les signalements citoyens entrants.

Classification multilingue (FR/SW/LN/KG/TS) sur 14 classes de sinistres.
Clustering géo-temporel heuristique pour détecter les événements convergents.
Score de priorisation basé sur urgence × fiabilité × taille du cluster.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any

import structlog

from agents import bus

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Classes de classification
# ---------------------------------------------------------------------------

CLASSES: list[str] = [
    "INONDATION",
    "GLISSEMENT",
    "EBOULEMENT",
    "INCENDIE",
    "ERUPTION",
    "SEISME",
    "SECHERESSE",
    "DEPLACEMENT",
    "EPIDEMIE",
    "URGENCE_SANITAIRE",
    "CONFLIT",
    "DESTRUCTION",
    "RUPTURE",
    "AUTRE",
]

# ---------------------------------------------------------------------------
# Lexique multilingue
# ---------------------------------------------------------------------------

KEYWORD_LEXICON: dict[str, dict[str, list[str]]] = {
    "INONDATION": {
        "FR": ["inondation", "inondé", "débordement", "crues", "montée des eaux"],
        "SW": ["mafuriko", "mafuriko makubwa", "gariko", "maji mengi", "mto kufurika"],
        "LN": ["mai ebimi", "mai ekateli", "mai ya ebele", "mai elongi"],
        "KG": ["maza ma nsi", "maza ma mbu", "maza manene", "maza ma mbidi"],
        "TS": ["meji", "meji abua", "meji mukua", "meji a busua"],
    },
    "GLISSEMENT": {
        "FR": ["glissement de terrain", "glissement", "coulée de boue", "éboulement de sol", "talus"],
        "SW": ["maporomoko ya ardhi", "ardhi kuteleza", "tifutifu", "udongo kuporomoka"],
        "LN": ["mabele ekweyi", "bwato ya mabele", "mabele eleki", "mabele ekitaki"],
        "KG": ["ntoto yayika", "ntoto makese", "ntoto yayidika", "ntoto yafwidi"],
        "TS": ["butoto buanguka", "butoto bupema", "butoto bupanguka", "ntoto ianguka"],
    },
    "EBOULEMENT": {
        "FR": ["éboulement", "effondrement", "chute de rochers", "falaise", "effritement"],
        "SW": ["maporomoko ya miamba", "jiwe kuanguka", "mlima kupasuka", "jabali kushuka"],
        "LN": ["libanga ekweyi", "mabele ekitaki", "libanga elongi", "efunduka"],
        "KG": ["mvutu yafwidi", "libanga yayika", "mvutu makese", "libanga yikidi"],
        "TS": ["libanga ianguka", "lupangu lupanguka", "mutu wa mabwe", "mabwe kupuka"],
    },
    "INCENDIE": {
        "FR": ["incendie", "feu", "brûlé", "flammes", "fumée"],
        "SW": ["moto", "moto mkubwa", "kuchomwa moto", "miali ya moto", "nyumba inawaka"],
        "LN": ["moto", "moto monene", "moto ezimaki te", "bilanga ya moto"],
        "KG": ["moyo", "moyo ukulu", "ntelo ya moyo", "ntoto ya moyo"],
        "TS": ["moto", "moto mukua", "difuku dya moto", "moto wa nzubu"],
    },
    "ERUPTION": {
        "FR": ["éruption", "volcan", "lave", "cendres volcaniques", "nuage de cendres"],
        "SW": ["mlipuko wa volkano", "lava", "majivu ya volkano", "volkano kulipuka"],
        "LN": ["ngomba olingi", "lava", "mapupu ya ngomba", "ngomba etumaki"],
        "KG": ["ngomba ya moto", "lava", "mvutu ya ngomba", "ngomba ya moyo"],
        "TS": ["ngomba wa moto", "lava", "majivu a ngomba", "ngomba kupuka"],
    },
    "SEISME": {
        "FR": ["séisme", "tremblement de terre", "secousse", "magnitude", "répliques"],
        "SW": ["tetemeko la ardhi", "ardhi kutetemeka", "mshtuko wa ardhi", "seismu"],
        "LN": ["mabele elongaki", "solo etetemaki", "mabele eshindaki", "tekemelo"],
        "KG": ["ntoto yatetemene", "ntoto yashindike", "ntoto yayisilama", "tremblement"],
        "TS": ["ntoto yatetemine", "ntoto yashindike", "mpinduki wa ntoto", "seisme"],
    },
    "SECHERESSE": {
        "FR": ["sécheresse", "manque de pluie", "aridité", "pénurie d'eau", "sol desséché"],
        "SW": ["ukame", "ukosefu wa mvua", "ardhi kavu", "maji kukosekana", "kiangazi"],
        "LN": ["mbula ekufi te", "esika ya mai", "mai ezalaki te", "esike ya mbula"],
        "KG": ["mvula kieki", "ntoto wa nzala", "mai makesi", "kimvula ko"],
        "TS": ["mvula iakufi", "ntoto wa nzala", "meji makufi", "mai makufi"],
    },
    "DEPLACEMENT": {
        "FR": ["déplacement", "réfugiés", "fuite", "exode", "personnes déplacées"],
        "SW": ["uhamisho", "wakimbizi", "kukimbia", "watu wanaokimbia", "makazi ya muda"],
        "LN": ["bato bakimi", "bato balongwi", "kobima", "bato ya kolongwa", "refugee"],
        "KG": ["bantu bakimba", "bafwiti", "kufwita", "bantu bakimbi", "déplacés"],
        "TS": ["bantu bakimba", "bafutu", "kufuta", "batu bakimbi", "déplacés"],
    },
    "EPIDEMIE": {
        "FR": ["épidémie", "maladie", "contagion", "foyer de maladie", "cas groupés"],
        "SW": ["janga la ugonjwa", "ugonjwa kuenea", "mlipuko wa ugonjwa", "maambukizi"],
        "LN": ["maladi epalangani", "maladi monene", "bakufi ya maladi", "mbangi ya maladi"],
        "KG": ["mpe ya nkele", "nkele ya bikalulu", "mpe makulu", "luvunu ya nkele"],
        "TS": ["ditu dya bulwele", "bulwele bupanduka", "bulwele bukata", "mpe ya bulwele"],
    },
    "URGENCE_SANITAIRE": {
        "FR": ["urgence sanitaire", "hôpital débordé", "manque de médicaments", "soins", "santé"],
        "SW": ["dharura ya afya", "hospitali imejaa", "dawa kukosekana", "matibabu", "afya"],
        "LN": ["lopitalo ezali to", "biloko ya bopeto", "bopeto ya nzoto", "santé ya moto"],
        "KG": ["hopitalo ya mpasi", "nkisi makesi", "kia kiangudi", "santé ya mpasi"],
        "TS": ["lopitalo wa nzala", "nkisi makufi", "bukolwa bwa bulwele", "santé mpasi"],
    },
    "CONFLIT": {
        "FR": ["conflit", "attaque", "violence", "milice", "combats"],
        "SW": ["mzozo", "shambulio", "vurugu", "kikosi cha wanamgambo", "mapigano"],
        "LN": ["bitumba", "bitumba ya bato", "makambo ya nkembo", "boleli", "guerre"],
        "KG": ["fulu", "luta ya bantu", "luta makulu", "nkaka ya bantu", "bitumba"],
        "TS": ["bitumba", "bitumba bya batu", "makambo ya zamba", "nkaka ya batu", "guerre"],
    },
    "DESTRUCTION": {
        "FR": ["destruction", "maisons détruites", "dégâts", "ruines", "démolition"],
        "SW": ["uharibifu", "nyumba zilizoharibiwa", "magofu", "uharibifu mkubwa", "bomoa"],
        "LN": ["nyumba ekweyi", "nyumba ya kobebisa", "bozangi", "ekotisi", "destruction"],
        "KG": ["nzo yakitika", "nzo ya vumba", "mvumba wa nzo", "destruction", "kunika"],
        "TS": ["nzubu ianguka", "nzubu wa vumba", "kabu ka nzubu", "destruction", "lufuki"],
    },
    "RUPTURE": {
        "FR": ["rupture de barrage", "rupture de pont", "coupure de route", "rupture", "effondrement"],
        "SW": ["bwawa kuvunjika", "daraja kuvunjika", "barabara kukatika", "kuvunjika", "kuporomoka"],
        "LN": ["pont ekweyi", "nzela ekangami", "pont ebukaki", "baraje ekweyi", "nzela efungami"],
        "KG": ["pont yayika", "nzila yakanga", "pont yabukidi", "baraje yayika", "rupture"],
        "TS": ["pont ianguka", "nzila ikanga", "pont ibukidi", "baraje ianguka", "rupture"],
    },
    "AUTRE": {
        "FR": ["incident", "problème", "situation d'urgence", "alerte", "signalement"],
        "SW": ["tukio", "tatizo", "hali ya dharura", "tahadhari", "ripoti"],
        "LN": ["likambo", "problème", "urgent", "alerte", "signalement"],
        "KG": ["likambo", "nzo ya mpasi", "urgent", "alerte", "signalement"],
        "TS": ["likambo", "muoyo wa mpasi", "urgent", "alerte", "signalement"],
    },
}

# ---------------------------------------------------------------------------
# Score de fiabilité
# ---------------------------------------------------------------------------

BASE_RELIABILITY: float = 0.50

RELIABILITY_ADJUSTMENTS: dict[str, float] = {
    "channel_field_agent": +0.30,
    "channel_authority": +0.25,
    "channel_verified_app": +0.10,
    "channel_sms": +0.05,
    "has_photo": +0.10,
    "has_video": +0.15,
    "has_gps": +0.10,
    "geo_coherent": +0.10,
    "good_track_record": +0.10,
    "suspected_duplicate": -0.20,
    "flagged_declarant": -0.15,
}

# ---------------------------------------------------------------------------
# Urgence par classe
# ---------------------------------------------------------------------------

URGENCE_PAR_CLASSE: dict[str, float] = {
    "INONDATION": 0.90,
    "GLISSEMENT": 0.85,
    "EBOULEMENT": 0.85,
    "INCENDIE": 0.88,
    "ERUPTION": 1.00,
    "SEISME": 1.00,
    "SECHERESSE": 0.60,
    "DEPLACEMENT": 0.75,
    "EPIDEMIE": 1.00,
    "URGENCE_SANITAIRE": 0.92,
    "CONFLIT": 0.95,
    "DESTRUCTION": 0.70,
    "RUPTURE": 0.80,
    "AUTRE": 0.40,
}

# ---------------------------------------------------------------------------
# Seuils de priorisation
# ---------------------------------------------------------------------------

SEUIL_IMMEDIAT: float = 0.80
SEUIL_TABLEAU_BORD: float = 0.50

# Rayon en km pour le clustering (approximation degrés → km : 1° ≈ 111 km)
CLUSTER_RADIUS_DEG: float = 10.0 / 111.0
# Fenêtre temporelle pour le clustering (secondes)
CLUSTER_WINDOW_SECONDS: int = 6 * 3600
# Taille minimale de cluster pour déclencher une alerte
CLUSTER_MIN_SIZE: int = 3
# Fiabilité agrégée minimale pour publier sur le bus
CLUSTER_MIN_FIABILITE: float = 0.60

# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

_SIGNALEMENT_STORE: list[dict[str, Any]] = []


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class SignalementsAgent:
    """
    Classifie et priorise les signalements citoyens entrants.

    Workflow :
    1. classify(text) — keyword matching multilingue → (classe, confiance)
    2. compute_reliability(metadata) — ajustements sur les signaux disponibles
    3. score de priorisation → urgence × fiabilité × cluster_factor
    4. clustering géo-temporel heuristique → alerte Agent 2 si cluster détecté
    """

    def classify(self, text: str) -> tuple[str, float]:
        """
        Classe un texte libre en utilisant le lexique multilingue.

        Retourne (classe, confiance) où confiance ∈ [0.0, 1.0].
        La classe AUTRE est retournée si aucun mot-clé ne correspond.
        """
        text_lower = text.lower()
        scores: dict[str, int] = {cls: 0 for cls in CLASSES}

        for classe, langs in KEYWORD_LEXICON.items():
            for _lang, keywords in langs.items():
                for kw in keywords:
                    if kw in text_lower:
                        scores[classe] += 1

        best_classe = max(scores, key=lambda c: scores[c])
        best_count = scores[best_classe]

        if best_count == 0:
            return "AUTRE", 0.10

        # Normaliser : plus il y a de mots-clés uniques (max ~20 par classe),
        # plus la confiance est élevée, plafonnée à 0.95
        total_keywords = sum(
            len(kws)
            for kws in KEYWORD_LEXICON.get(best_classe, {}).values()
        )
        confiance = min(0.95, best_count / max(total_keywords, 1) * 10)
        confiance = max(confiance, 0.20)  # confiance minimale si au moins 1 mot-clé

        logger.debug(
            "signalements_agent.classify",
            best_classe=best_classe,
            best_count=best_count,
            confiance=round(confiance, 3),
        )
        return best_classe, round(confiance, 3)

    def compute_reliability(self, metadata: dict[str, Any]) -> float:
        """
        Calcule le score de fiabilité [0.0, 1.0] en appliquant les ajustements
        définis dans RELIABILITY_ADJUSTMENTS.

        metadata peut contenir :
          - channel: str (ex. "field_agent", "authority", "sms", "verified_app")
          - has_photo: bool
          - has_video: bool
          - has_gps: bool
          - geo_coherent: bool
          - good_track_record: bool
          - suspected_duplicate: bool
          - flagged_declarant: bool
        """
        score = BASE_RELIABILITY

        channel = metadata.get("channel", "")
        channel_key = f"channel_{channel}"
        if channel_key in RELIABILITY_ADJUSTMENTS:
            score += RELIABILITY_ADJUSTMENTS[channel_key]

        for flag in [
            "has_photo",
            "has_video",
            "has_gps",
            "geo_coherent",
            "good_track_record",
            "suspected_duplicate",
            "flagged_declarant",
        ]:
            if metadata.get(flag, False):
                score += RELIABILITY_ADJUSTMENTS.get(flag, 0.0)

        return round(max(0.0, min(1.0, score)), 3)

    def process(self, signalement: dict[str, Any]) -> dict[str, Any]:
        """
        Traite un signalement entrant :
        1. Classification du texte
        2. Calcul de la fiabilité
        3. Score de priorisation
        4. Stockage
        5. Clustering et publication sur le bus si nécessaire

        Champs attendus dans signalement :
          - text: str
          - source: str (optionnel)
          - channel: str (optionnel)
          - metadata: dict (optionnel)
          - province: str (optionnel)
          - lat: float (optionnel)
          - lon: float (optionnel)
        """
        text: str = signalement.get("text", "")
        metadata: dict[str, Any] = signalement.get("metadata", {})

        # Copier channel dans metadata si fourni au niveau racine
        if "channel" in signalement and "channel" not in metadata:
            metadata["channel"] = signalement["channel"]

        classe, confiance = self.classify(text)
        fiabilite = self.compute_reliability(metadata)
        urgence = URGENCE_PAR_CLASSE.get(classe, 0.40)

        # Cluster_size sera mis à jour lors du clustering (défaut 1)
        cluster_size = 1
        score = urgence * fiabilite * (min(cluster_size, 5) / 5)

        if score >= SEUIL_IMMEDIAT:
            priorite = "IMMEDIAT"
        elif score >= SEUIL_TABLEAU_BORD:
            priorite = "TABLEAU_BORD_4H"
        else:
            priorite = "MODERATION_24H"

        enriched: dict[str, Any] = {
            "id": signalement.get("id", str(uuid.uuid4())),
            "received_at": datetime.now(timezone.utc).isoformat(),
            "text": text,
            "source": signalement.get("source", "inconnu"),
            "channel": signalement.get("channel", "inconnu"),
            "province": signalement.get("province", ""),
            "lat": signalement.get("lat"),
            "lon": signalement.get("lon"),
            "metadata": metadata,
            "classe": classe,
            "confiance": confiance,
            "fiabilite": fiabilite,
            "urgence": urgence,
            "cluster_size": cluster_size,
            "score": round(score, 4),
            "priorite": priorite,
        }

        _SIGNALEMENT_STORE.append(enriched)

        logger.info(
            "signalements_agent.processed",
            id=enriched["id"],
            classe=classe,
            confiance=confiance,
            fiabilite=fiabilite,
            score=round(score, 4),
            priorite=priorite,
        )

        return enriched

    async def _check_and_publish_clusters(self) -> None:
        """
        Vérifie les clusters géo-temporels et publie sur le bus
        si un cluster atteint le seuil de déclenchement.
        Méthode appelée en interne après chaque traitement.
        """
        clusters = self.get_clusters()
        for cluster in clusters:
            if (
                cluster["size"] >= CLUSTER_MIN_SIZE
                and cluster["fiabilite_agregee"] >= CLUSTER_MIN_FIABILITE
            ):
                await bus.publish(
                    "signalements.new",
                    {
                        "classe": cluster["classe"],
                        "cluster_size": cluster["size"],
                        "province": cluster["province"],
                        "fiabilite_agregee": cluster["fiabilite_agregee"],
                        "score_max": cluster["score_max"],
                    },
                )
                logger.info(
                    "signalements_agent.cluster_published",
                    classe=cluster["classe"],
                    province=cluster["province"],
                    size=cluster["size"],
                )

    def get_clusters(self) -> list[dict[str, Any]]:
        """
        Clustering géo-temporel heuristique :
        - Regroupe les signalements par (classe, province, fenêtre 6h)
        - Si ≥ 3 signalements dans un rayon ~10 km + même type → cluster

        Retourne une liste de clusters avec métadonnées agrégées.
        """
        now_ts = datetime.now(timezone.utc).timestamp()
        clusters: list[dict[str, Any]] = []

        # Grouper par (classe, province)
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for s in _SIGNALEMENT_STORE:
            received_at_str = s.get("received_at", "")
            try:
                received_ts = datetime.fromisoformat(received_at_str).timestamp()
            except Exception:
                continue
            if now_ts - received_ts > CLUSTER_WINDOW_SECONDS:
                continue

            key = (s["classe"], s.get("province", ""))
            groups.setdefault(key, []).append(s)

        for (classe, province), members in groups.items():
            if len(members) < CLUSTER_MIN_SIZE:
                continue

            # Vérifier la proximité géographique si les coordonnées sont disponibles
            geo_members = [m for m in members if m.get("lat") is not None and m.get("lon") is not None]
            if geo_members:
                # Trouver les sous-groupes dans le rayon
                clustered = _geo_cluster(geo_members, CLUSTER_RADIUS_DEG)
                for sub in clustered:
                    if len(sub) >= CLUSTER_MIN_SIZE:
                        fiabilites = [m["fiabilite"] for m in sub]
                        fiabilite_agregee = round(sum(fiabilites) / len(fiabilites), 3)
                        scores = [m["score"] for m in sub]
                        clusters.append({
                            "classe": classe,
                            "province": province,
                            "size": len(sub),
                            "fiabilite_agregee": fiabilite_agregee,
                            "score_max": round(max(scores), 4),
                            "ids": [m["id"] for m in sub],
                        })
            else:
                # Pas de coordonnées : cluster par (classe, province, fenêtre)
                if len(members) >= CLUSTER_MIN_SIZE:
                    fiabilites = [m["fiabilite"] for m in members]
                    fiabilite_agregee = round(sum(fiabilites) / len(fiabilites), 3)
                    scores = [m["score"] for m in members]
                    clusters.append({
                        "classe": classe,
                        "province": province,
                        "size": len(members),
                        "fiabilite_agregee": fiabilite_agregee,
                        "score_max": round(max(scores), 4),
                        "ids": [m["id"] for m in members],
                    })

        return clusters

    def get_priority_queue(self, min_score: float = 0.0) -> list[dict[str, Any]]:
        """
        Retourne les signalements triés par score décroissant,
        filtrés par score minimal.
        """
        filtered = [s for s in _SIGNALEMENT_STORE if s["score"] >= min_score]
        return sorted(filtered, key=lambda s: s["score"], reverse=True)

    def get_stats(self) -> dict[str, Any]:
        """Retourne les statistiques agrégées des signalements."""
        total = len(_SIGNALEMENT_STORE)
        by_classe: dict[str, int] = {}
        by_priorite: dict[str, int] = {}

        for s in _SIGNALEMENT_STORE:
            by_classe[s["classe"]] = by_classe.get(s["classe"], 0) + 1
            by_priorite[s["priorite"]] = by_priorite.get(s["priorite"], 0) + 1

        avg_fiabilite = (
            sum(s["fiabilite"] for s in _SIGNALEMENT_STORE) / total if total > 0 else 0.0
        )
        avg_score = (
            sum(s["score"] for s in _SIGNALEMENT_STORE) / total if total > 0 else 0.0
        )

        return {
            "total": total,
            "by_classe": by_classe,
            "by_priorite": by_priorite,
            "average_fiabilite": round(avg_fiabilite, 3),
            "average_score": round(avg_score, 4),
            "cluster_count": len(self.get_clusters()),
        }

    def get_store(self) -> list[dict[str, Any]]:
        """
        Retourne l'ensemble du store (pour l'Agent 8 — épidémie).
        """
        return list(_SIGNALEMENT_STORE)


# ---------------------------------------------------------------------------
# Utilitaire géo
# ---------------------------------------------------------------------------


def _geo_cluster(
    members: list[dict[str, Any]],
    radius_deg: float,
) -> list[list[dict[str, Any]]]:
    """
    Clustering heuristique simple par rayon euclidien (degrés lat/lon).
    Retourne une liste de sous-groupes.
    """
    visited: set[int] = set()
    clusters: list[list[dict[str, Any]]] = []

    for i, m in enumerate(members):
        if i in visited:
            continue
        group = [m]
        visited.add(i)
        for j, other in enumerate(members):
            if j in visited:
                continue
            dist = math.sqrt(
                (m["lat"] - other["lat"]) ** 2 + (m["lon"] - other["lon"]) ** 2
            )
            if dist <= radius_deg:
                group.append(other)
                visited.add(j)
        clusters.append(group)

    return clusters


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

signalements_agent = SignalementsAgent()
