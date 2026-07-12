"""
IndexeurRAG — découpe les documents en fragments et crée leurs embeddings.
Mode dégradé trigram si VOYAGE_API_KEY absent ou voyageai non installé.
"""
from __future__ import annotations

import os
import structlog
from sqlalchemy import text

from db import engine

logger = structlog.get_logger(__name__)

VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY", "")
_voyage_client = None


def _get_voyage():
    global _voyage_client
    if _voyage_client is not None:
        return _voyage_client
    if not VOYAGE_API_KEY:
        return None
    try:
        import voyageai  # type: ignore
        _voyage_client = voyageai.AsyncClient(api_key=VOYAGE_API_KEY)
        logger.info("Voyage AI initialisé — recherche vectorielle activée")
        return _voyage_client
    except ImportError:
        logger.warning("voyageai non installé — mode trigram uniquement (pip install voyageai)")
        return None


class IndexeurRAG:
    """Découpe les documents et crée leurs embeddings."""

    def decouper(self, texte: str, taille: int = 800, chevauchement: int = 150) -> list[str]:
        """Fragmente le texte en morceaux avec chevauchement pour préserver le contexte."""
        texte = texte.strip()
        if not texte:
            return []
        fragments: list[str] = []
        i = 0
        while i < len(texte):
            fin = min(i + taille, len(texte))
            if fin < len(texte):
                coupe = texte.rfind(". ", i, fin)
                if coupe > i + chevauchement:
                    fin = coupe + 1
            frag = texte[i:fin].strip()
            if frag:
                fragments.append(frag)
            i = fin - chevauchement if fin < len(texte) else fin
        return fragments

    async def creer_embedding(self, texte: str) -> list[float] | None:
        client = _get_voyage()
        if client is None:
            return None
        try:
            result = await client.embed([texte], model="voyage-large-2", input_type="document")
            return result.embeddings[0]
        except Exception as e:
            logger.warning("Embedding failed", error=str(e))
            return None

    async def indexer_document(
        self,
        titre: str,
        type_document: str,
        source: str,
        texte: str,
        date_publication: str | None = None,
        fiabilite: float = 0.70,
        themes: list[str] | None = None,
        url: str | None = None,
        ajoute_par: str = "system",
    ) -> int:
        themes = themes or []
        async with engine.begin() as conn:
            result = await conn.execute(
                text("""
                    INSERT INTO kb_document
                        (titre, type_document, source, url, date_publication,
                         fiabilite, themes, contenu_brut, ajoute_par)
                    VALUES (:titre, :type, :source, :url, :date,
                            :fiab, :themes, :contenu, :par)
                    RETURNING id
                """),
                {
                    "titre": titre, "type": type_document, "source": source,
                    "url": url, "date": date_publication,
                    "fiab": fiabilite, "themes": themes,
                    "contenu": texte, "par": ajoute_par,
                },
            )
            doc_id: int = result.scalar_one()

        fragments = self.decouper(texte)
        nb_ok = 0
        for i, frag in enumerate(fragments):
            embedding = await self.creer_embedding(frag)
            async with engine.begin() as conn:
                if embedding is not None:
                    emb_str = f"[{','.join(str(x) for x in embedding)}]"
                    await conn.execute(
                        text("""
                            INSERT INTO kb_fragment
                                (document_id, contenu, embedding, position_ordre, themes)
                            VALUES (:doc_id, :contenu, :emb::vector, :pos, :themes)
                        """),
                        {"doc_id": doc_id, "contenu": frag, "emb": emb_str,
                         "pos": i, "themes": themes},
                    )
                else:
                    await conn.execute(
                        text("""
                            INSERT INTO kb_fragment
                                (document_id, contenu, position_ordre, themes)
                            VALUES (:doc_id, :contenu, :pos, :themes)
                        """),
                        {"doc_id": doc_id, "contenu": frag, "pos": i, "themes": themes},
                    )
            nb_ok += 1

        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE kb_document SET nb_fragments = :n, indexe_le = NOW() WHERE id = :id"),
                {"n": nb_ok, "id": doc_id},
            )

        logger.info(
            "Document indexé",
            doc_id=doc_id, titre=titre, fragments=nb_ok,
            avec_embeddings=(_get_voyage() is not None),
        )
        return doc_id

    async def supprimer_document(self, doc_id: int) -> bool:
        async with engine.begin() as conn:
            result = await conn.execute(
                text("DELETE FROM kb_document WHERE id = :id RETURNING id"),
                {"id": doc_id},
            )
            return result.rowcount > 0


indexeur_rag = IndexeurRAG()
