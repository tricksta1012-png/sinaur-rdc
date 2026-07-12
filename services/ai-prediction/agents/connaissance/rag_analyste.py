"""
AnalysteContextuel RAG — enrichit un événement par la base documentaire.
Recherche les fragments pertinents (vectorielle ou trigram) puis interprète
l'événement via Claude Haiku.
"""
from __future__ import annotations

import os
import structlog
import anthropic
from sqlalchemy import text

from db import engine
from .rag_indexeur import indexeur_rag, VOYAGE_API_KEY

logger = structlog.get_logger(__name__)

_anthropic = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

_SYSTEM_PROMPT = """Tu es analyste spécialiste des conflits armés pour SINAUR-RDC, le système national d'alerte et de réponse aux sinistres de la République Démocratique du Congo.

On te donne un ÉVÉNEMENT récent et des EXTRAITS de documents analytiques de référence sur les conflits et dynamiques humanitaires en RDC.

Fournis une analyse structurée en 4 parties :
**FAIT :** Ce qui est rapporté — neutre, sans extrapoler au-delà des informations données.
**CONTEXTE :** Ce que les documents apportent pour comprendre : groupe(s) armé(s) potentiellement impliqué(s), zone géographique, historique local, dynamiques connues.
**DYNAMIQUE PROBABLE :** Ce qui pourrait suivre — déplacements attendus, axes probables, risque d'escalade. Précise explicitement qu'il s'agit d'une hypothèse.
**SOURCES :** Liste les documents qui ont éclairé cette analyse.

RÈGLES :
- Distingue TOUJOURS le FAIT (observé) de l'INTERPRÉTATION (hypothèse).
- Si les documents de référence sont anciens (> 1 an), signale que la situation a pu évoluer.
- N'invente aucun fait. Si le contexte est insuffisant, dis-le.
- Reste factuel et mesuré. Réponds en français."""


class AnalysteContextuel:

    async def analyser_evenement(self, evenement: dict) -> dict:
        titre = evenement.get("titre", "")
        description = evenement.get("description", evenement.get("content", ""))
        query = f"{titre} {description}".strip()

        fragments = await self._rechercher_contexte(query)
        if not fragments:
            return {
                "analyse": None,
                "sources_utilisees": [],
                "pertinence_max": 0.0,
                "contexte_insuffisant": True,
            }

        analyse = await self._interpreter(evenement, fragments)
        sources = list({f["source"] for f in fragments if f.get("source")})
        pertinence_max = float(max((f.get("pertinence", 0.0) for f in fragments), default=0.0))
        fragment_ids = [int(f["id"]) for f in fragments if f.get("id")]

        async with engine.begin() as conn:
            await conn.execute(
                text("""
                    INSERT INTO kb_analyse
                        (evenement_id, evenement_titre, evenement_desc, source_agent,
                         analyse_brute, sources_utilisees, pertinence_max, fragments_utilises)
                    VALUES (:eid, :titre, :desc, :agent,
                            :brute, :sources, :pert, :frags)
                """),
                {
                    "eid":    str(evenement.get("id", "")),
                    "titre":  titre[:500],
                    "desc":   (description or "")[:500],
                    "agent":  evenement.get("source_agent", "conflit"),
                    "brute":  analyse,
                    "sources": sources,
                    "pert":   pertinence_max,
                    "frags":  fragment_ids,
                },
            )

        return {
            "analyse": analyse,
            "sources_utilisees": sources,
            "pertinence_max": pertinence_max,
        }

    async def _rechercher_contexte(self, query: str) -> list[dict]:
        # Essai 1 : recherche vectorielle si embeddings disponibles
        if VOYAGE_API_KEY:
            embedding = await indexeur_rag.creer_embedding(query)
            if embedding:
                emb_str = f"[{','.join(str(x) for x in embedding)}]"
                async with engine.connect() as conn:
                    rows = await conn.execute(
                        text("""
                            SELECT f.id, f.contenu, d.titre, d.source,
                                   d.date_publication, d.fiabilite,
                                   1 - (f.embedding <=> :emb::vector) AS pertinence
                            FROM kb_fragment f
                            JOIN kb_document d ON d.id = f.document_id
                            WHERE f.embedding IS NOT NULL
                            ORDER BY f.embedding <=> :emb::vector
                            LIMIT 6
                        """),
                        {"emb": emb_str},
                    )
                    results = [dict(r._mapping) for r in rows.fetchall()]
                if results:
                    return results

        # Fallback trigram : recherche par mots-clés (fonctionne sans API)
        mots = [m for m in query.split() if len(m) > 3][:8]
        if not mots:
            return []

        conditions = " OR ".join(f"f.contenu ILIKE :m{i}" for i in range(len(mots)))
        params: dict = {f"m{i}": f"%{m}%" for i, m in enumerate(mots)}

        async with engine.connect() as conn:
            rows = await conn.execute(
                text(f"""
                    SELECT DISTINCT ON (f.id) f.id, f.contenu, d.titre, d.source,
                           d.date_publication, d.fiabilite, 0.5 AS pertinence
                    FROM kb_fragment f
                    JOIN kb_document d ON d.id = f.document_id
                    WHERE {conditions}
                    LIMIT 6
                """),
                params,
            )
        return [dict(r._mapping) for r in rows.fetchall()]

    async def _interpreter(self, evenement: dict, fragments: list[dict]) -> str:
        parties = []
        for f in fragments:
            date_pub = str(f.get("date_publication") or "date inconnue")
            source = f.get("source") or "source inconnue"
            titre_doc = f.get("titre") or ""
            parties.append(f"[{titre_doc} — {source}, {date_pub}]\n{f['contenu']}")
        contexte = "\n\n---\n\n".join(parties)

        titre = evenement.get("titre", "Événement sans titre")
        desc = evenement.get("description", evenement.get("content", ""))

        message = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1400,
            system=_SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": (
                    f"ÉVÉNEMENT À ANALYSER :\n{titre}\n"
                    + (f"{desc}\n" if desc else "")
                    + f"\nDOCUMENTS DE RÉFÉRENCE :\n{contexte}"
                ),
            }],
        )
        return message.content[0].text if message.content else ""


analyste_contextuel = AnalysteContextuel()
