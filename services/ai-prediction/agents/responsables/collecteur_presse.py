"""
CollecteurPresse — télécharge et parse les flux RSS des médias congolais.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET

import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "SINAUR-RDC/1.0"}
_TIMEOUT = 15.0

# Namespaces RSS/Atom courants
_NS = {
    'content': 'http://purl.org/rss/1.0/modules/content/',
    'dc': 'http://purl.org/dc/elements/1.1/',
}


class CollecteurPresse:
    """Collecte et parse les flux RSS des médias congolais."""

    async def fetch_articles(self, source_id: str, config: dict) -> list[dict]:
        """
        Télécharge le RSS et extrait les articles.

        Retourne une liste de dicts : titre, texte, url, source_id.
        En cas d'erreur (timeout, HTTP error, parse error) : log warning et retourne [].
        """
        rss_url = config.get('rss', '')
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
                resp = await client.get(rss_url)
                resp.raise_for_status()
                content = resp.text
        except httpx.TimeoutException:
            logger.warning("collecteur_presse.timeout", source_id=source_id, url=rss_url)
            return []
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "collecteur_presse.http_error",
                source_id=source_id,
                url=rss_url,
                status=exc.response.status_code,
            )
            return []
        except Exception as exc:
            logger.warning("collecteur_presse.fetch_error", source_id=source_id, url=rss_url, error=str(exc))
            return []

        try:
            return self._parse_rss(content, source_id)
        except Exception as exc:
            logger.warning("collecteur_presse.parse_error", source_id=source_id, url=rss_url, error=str(exc))
            return []

    def _parse_rss(self, content: str, source_id: str) -> list[dict]:
        """Parse le XML RSS et retourne les articles."""
        root = ET.fromstring(content)
        articles: list[dict] = []

        # Support RSS 2.0 (channel/item) et Atom (feed/entry)
        items = root.findall('.//item') or root.findall('.//{http://www.w3.org/2005/Atom}entry')

        for item in items:
            titre = self._get_text(item, ['title', '{http://www.w3.org/2005/Atom}title'])
            texte = self._get_text(item, [
                'description',
                'summary',
                '{http://www.w3.org/2005/Atom}summary',
                '{http://www.w3.org/2005/Atom}content',
                '{http://purl.org/rss/1.0/modules/content/}encoded',
            ])
            lien = self._get_text(item, ['link', '{http://www.w3.org/2005/Atom}link'])
            # Pour les éléments Atom <link href="..."/>
            if not lien:
                link_el = item.find('{http://www.w3.org/2005/Atom}link')
                if link_el is not None:
                    lien = link_el.get('href', '')

            if not titre and not texte:
                continue

            articles.append({
                'titre': (titre or '').strip(),
                'texte': f"{titre or ''} {texte or ''}".strip(),
                'url': (lien or '').strip(),
                'source_id': source_id,
            })

        return articles

    def _get_text(self, element: ET.Element, tags: list[str]) -> str:
        """Retourne le texte du premier tag trouvé, ou chaîne vide."""
        for tag in tags:
            child = element.find(tag)
            if child is not None and child.text:
                return child.text
        return ''


collecteur_presse = CollecteurPresse()
