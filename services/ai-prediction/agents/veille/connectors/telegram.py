"""
Connecteur Telegram — canaux publics d'actualité RDC.

Deux modes selon la configuration :
  1. Web preview t.me/s/{channel} — tous canaux publics, sans clé API.
  2. Bot API getUpdates — canaux/groupes où le bot est membre ou admin
     (TELEGRAM_BOT_TOKEN dans .env).

Priorité : Bot API si token présent, sinon web preview.
Les deux modes filtrent par mots-clés et normalisent en CanonicalEvent.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import structlog

from agents.veille.connectors.base import AbstractConnector
from agents.veille.normalizer import PROVINCE_PCODE_MAP
from schemas.events import CanonicalEvent, EventType, RawEvent

logger = structlog.get_logger(__name__)

# ── Canaux surveillés par défaut ──────────────────────────────────────────────
# (username, label, mode)  mode: "web" | "bot_api"
_DEFAULT_CHANNELS: list[tuple[str, str]] = [
    ("RadioOkapi",     "Radio Okapi — radio ONU/RDC"),
    ("actualite_cd",   "Actualité.cd — portail national"),
    ("7surSeptCD",     "7SUR7.CD — actualité RDC"),
    ("congoactualite", "Congo Actualité — analyse conflit Est"),
    ("kivusecurity",   "Kivu Security Tracker"),
    ("RFI_Afrique",    "RFI Afrique — couverture internationale"),
]

# ── Mots-clés de pertinence ───────────────────────────────────────────────────
_KEYWORDS = {
    # Conflits armés
    "conflit", "combat", "attaque", "armé", "milice", "rebelle", "groupe armé",
    "m23", "adf", "fdlr", "codeco", "wazalendo", "maï-maï",
    "tirs", "obus", "roquette", "embuscade", "accrochage", "offensive",
    # Victimes
    "mort", "tué", "blessé", "civil", "massacre", "exaction",
    "enlèvement", "otage", "viol",
    # Déplacements
    "déplacement", "deplacement", "déplacé", "réfugié", "refugié", "fuite", "exode",
    "pdi", "idp",
    # Humanitaire
    "humanitaire", "urgence", "secours", "ocha", "unhcr", "pam", "unicef",
    # Catastrophes
    "inondation", "glissement", "tremblement", "éruption", "volcan",
    "épidémie", "epidemie", "choléra", "cholera", "ebola", "mpox",
    # Swahili
    "vita", "mapigano", "wakimbizi", "vifo", "mafuriko",
    # Anglais
    "attack", "conflict", "displacement", "casualties", "armed group",
    "fighting", "clashes", "killed", "wounded", "militia",
}

# ── Détection de province dans le texte ──────────────────────────────────────
_PROVINCE_MAP: dict[str, tuple[str, str]] = {
    name.lower(): (name, code) for name, code in PROVINCE_PCODE_MAP.items()
}
_PROVINCE_MAP.update({
    "nord kivu": ("Nord-Kivu", "CD-NK"),
    "kivu nord": ("Nord-Kivu", "CD-NK"),
    "sud kivu": ("Sud-Kivu", "CD-SK"),
    "kivu sud": ("Sud-Kivu", "CD-SK"),
    "haut katanga": ("Haut-Katanga", "CD-HK"),
    "goma": ("Nord-Kivu", "CD-NK"),
    "beni": ("Nord-Kivu", "CD-NK"),
    "butembo": ("Nord-Kivu", "CD-NK"),
    "masisi": ("Nord-Kivu", "CD-NK"),
    "rutshuru": ("Nord-Kivu", "CD-NK"),
    "bukavu": ("Sud-Kivu", "CD-SK"),
    "uvira": ("Sud-Kivu", "CD-SK"),
    "fizi": ("Sud-Kivu", "CD-SK"),
    "bunia": ("Ituri", "CD-IT"),
    "djugu": ("Ituri", "CD-IT"),
    "lubumbashi": ("Haut-Katanga", "CD-HK"),
    "kinshasa": ("Kinshasa", "CD-KN"),
    "kisangani": ("Tshopo", "CD-TP"),
    "mbandaka": ("Équateur", "CD-EQ"),
    "kalemie": ("Tanganyika", "CD-TA"),
    "mbuji-mayi": ("Kasaï-Oriental", "CD-MK"),
    "mbuji mayi": ("Kasaï-Oriental", "CD-MK"),
})


def _detect_province(text: str) -> tuple[str | None, str | None]:
    """Detect first matching province name or city in text."""
    lower = text.lower()
    for key, (prov, code) in _PROVINCE_MAP.items():
        if key in lower:
            return prov, code
    return None, None


def _is_relevant(text: str) -> bool:
    """Return True if text contains at least one conflict/disaster keyword."""
    lower = text.lower()
    return any(kw in lower for kw in _KEYWORDS)


def _severity_from_text(text: str) -> int:
    lower = text.lower()
    if any(w in lower for w in ("massacre", "nombreux morts", "dizaines", "dozens killed", "offensive majeure")):
        return 4
    if any(w in lower for w in ("tués", "morts", "blessés", "killed", "wounded", "attaque", "combat")):
        return 3
    if any(w in lower for w in ("accrochage", "incident", "clashes", "deplacement", "déplacement")):
        return 2
    return 1


def _event_type_from_text(text: str) -> EventType:
    lower = text.lower()
    if any(w in lower for w in ("inondation", "mafuriko", "flood")):
        return EventType.INONDATION
    if any(w in lower for w in ("glissement", "landslide", "eboulement")):
        return EventType.GLISSEMENT
    if any(w in lower for w in ("choléra", "cholera", "ebola", "épidémie", "epidemie", "mpox", "fièvre")):
        return EventType.EPIDEMIE
    if any(w in lower for w in ("volcan", "eruption", "nyiragongo", "nyamulagira")):
        return EventType.VOLCAN
    if any(w in lower for w in ("deplacement", "déplacement", "réfugié", "refugié", "fuite", "exode", "idp", "pdi")):
        return EventType.DEPLACEMENT
    return EventType.CONFLIT


def _make_id(channel: str, text: str, dt: datetime) -> str:
    key = f"telegram:{channel}:{dt.isoformat()}:{text[:80]}"
    return hashlib.sha1(key.encode()).hexdigest()[:16]


# ─────────────────────────────────────────────────────────────────────────────
# Web preview parser  (t.me/s/{channel})
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_web_preview(
    client: httpx.AsyncClient,
    channel: str,
    cutoff: datetime,
) -> list[dict[str, Any]]:
    """
    Scrape t.me/s/{channel} and return dicts {text, dt, url, channel}.
    Uses lxml for robust HTML parsing.
    """
    url = f"https://t.me/s/{channel}"
    try:
        resp = await client.get(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0 Safari/537.36"
                ),
                "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            },
            follow_redirects=True,
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.warning("telegram.web_preview_error", channel=channel, error=str(exc))
        return []

    try:
        from lxml import html as lhtml
        tree = lhtml.fromstring(resp.text)
    except Exception as exc:
        logger.warning("telegram.parse_error", channel=channel, error=str(exc))
        return []

    posts: list[dict[str, Any]] = []
    # Each post is a div with class containing 'tgme_widget_message'
    msg_divs = tree.xpath(
        "//div[contains(@class,'tgme_widget_message') and "
        "not(contains(@class,'tgme_widget_message_wrap'))]"
    )
    for msg_div in msg_divs:
        # Extract text from message_text div
        text_nodes = msg_div.xpath(
            ".//div[contains(@class,'tgme_widget_message_text')]"
        )
        if not text_nodes:
            continue
        text = " ".join(
            re.sub(r"\s+", " ", n.text_content()).strip()
            for n in text_nodes
        ).strip()
        if not text:
            continue

        # Extract datetime from <time datetime="...">
        time_nodes = msg_div.xpath(".//time[@datetime]")
        dt: datetime = cutoff  # fallback
        if time_nodes:
            raw_dt = time_nodes[0].get("datetime", "")
            try:
                dt = datetime.fromisoformat(raw_dt.replace("Z", "+00:00"))
            except ValueError:
                pass

        if dt < cutoff:
            continue

        # Extract post URL from <a class="tgme_widget_message_date">
        link_nodes = msg_div.xpath(
            ".//a[contains(@class,'tgme_widget_message_date')]"
        )
        post_url = link_nodes[0].get("href", url) if link_nodes else url

        posts.append({"text": text, "dt": dt, "url": post_url, "channel": channel})

    logger.info("telegram.web_preview_fetched", channel=channel, posts=len(posts))
    return posts


# ─────────────────────────────────────────────────────────────────────────────
# Bot API parser  (getUpdates)
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_bot_api(
    client: httpx.AsyncClient,
    token: str,
    cutoff: datetime,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """
    Fetch channel_post updates via Bot API getUpdates.
    Works for channels/groups where the bot is a member/admin.
    """
    posts: list[dict[str, Any]] = []
    current_offset = offset
    while True:
        try:
            resp = await client.get(
                f"https://api.telegram.org/bot{token}/getUpdates",
                params={
                    "offset": current_offset,
                    "limit": 100,
                    "timeout": 0,
                    "allowed_updates": '["channel_post","message"]',
                },
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            logger.warning("telegram.bot_api_error", error=str(exc))
            break

        updates = data.get("result", [])
        if not updates:
            break

        for update in updates:
            current_offset = update["update_id"] + 1
            msg = update.get("channel_post") or update.get("message") or {}
            text = msg.get("text") or msg.get("caption") or ""
            if not text:
                continue
            ts = msg.get("date", 0)
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            if dt < cutoff:
                continue
            chat = msg.get("chat", {})
            channel = chat.get("username") or str(chat.get("id", "unknown"))
            chat_id = chat.get("id", 0)
            msg_id = msg.get("message_id", 0)
            post_url = (
                f"https://t.me/{channel}/{msg_id}"
                if chat.get("username")
                else f"https://t.me/c/{abs(chat_id)}/{msg_id}"
            )
            posts.append({"text": text, "dt": dt, "url": post_url, "channel": channel})

        if len(updates) < 100:
            break

    logger.info("telegram.bot_api_fetched", posts=len(posts))
    return posts


# ─────────────────────────────────────────────────────────────────────────────
# Connector class
# ─────────────────────────────────────────────────────────────────────────────

class TelegramConnector(AbstractConnector):
    """
    Collecte les messages des canaux Telegram publics relatifs aux crises RDC.
    Fréquence : 60 min (Bot API) ou 90 min (web preview).
    """

    source_id = "telegram"
    fetch_interval_minutes = 60
    max_retries = 2
    circuit_breaker_threshold = 5

    def __init__(
        self,
        channels: list[tuple[str, str]] | None = None,
        bot_token: str | None = None,
    ) -> None:
        super().__init__()
        self._channels = channels or _DEFAULT_CHANNELS
        self._bot_token = bot_token
        if not bot_token:
            # Web preview is slower/heavier — run less often
            self.fetch_interval_minutes = 90

    async def fetch(self) -> list[RawEvent]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        posts: list[dict[str, Any]] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            if self._bot_token:
                posts = await _fetch_bot_api(client, self._bot_token, cutoff)
            else:
                for username, _label in self._channels:
                    channel_posts = await _fetch_web_preview(client, username, cutoff)
                    posts.extend(channel_posts)

        now = datetime.now(timezone.utc)
        raw_events: list[RawEvent] = []
        for p in posts:
            if not _is_relevant(p["text"]):
                continue
            raw_events.append(
                RawEvent(
                    source_id=self.source_id,
                    external_id=_make_id(p["channel"], p["text"], p["dt"]),
                    raw_data={
                        "text":    p["text"],
                        "dt":      p["dt"].isoformat(),
                        "url":     p["url"],
                        "channel": p["channel"],
                    },
                    fetched_at=now,
                )
            )

        logger.info("telegram.fetch", total_posts=len(posts), relevant=len(raw_events))
        return raw_events

    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        d = raw.raw_data
        text: str = d.get("text", "")
        url: str  = d.get("url", "")
        channel: str = d.get("channel", "telegram")
        dt_str: str = d.get("dt", "")

        try:
            fetched_at = datetime.fromisoformat(dt_str) if dt_str else raw.fetched_at
        except ValueError:
            fetched_at = raw.fetched_at

        province, p_code = _detect_province(text)
        event_type = _event_type_from_text(text)
        severity = _severity_from_text(text)

        # Titre = première phrase ou 120 premiers caractères
        first_line = re.split(r"[.\n!?]", text)[0].strip()
        title = (first_line[:120] + "…") if len(first_line) > 120 else first_line
        if not title:
            title = f"Telegram/{channel} — {event_type.value}"

        # Description = texte complet tronqué à 800 chars
        description = text[:800] + ("…" if len(text) > 800 else "")

        return CanonicalEvent(
            source_id=raw.source_id,
            external_id=raw.external_id,
            event_type=event_type,
            title=title,
            description=description,
            p_code=p_code,
            province=province,
            severity=severity,
            source_url=url,
            raw_data=d,
            fetched_at=fetched_at,
            reliability_score=0.55,   # signal précoce, non vérifié
            needs_corroboration=True,
        )
