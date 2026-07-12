"""
Router ConnaissanceAgent — endpoints internes pour explorer le graphe de connaissance.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from db import engine
from sqlalchemy import text
import json

router = APIRouter(prefix="/internal/connaissance", tags=["connaissance"])


@router.get("/status")
async def get_status():
    from agents.connaissance.agent import connaissance_agent
    return connaissance_agent.get_status()


@router.get("/entites")
async def list_entites(
    type_entite: str | None = Query(None),
    statut: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    conditions = ["actif = true"]
    params: dict = {"limit": limit, "offset": offset}

    if type_entite:
        conditions.append("type_entite = :type")
        params["type"] = type_entite
    if statut:
        conditions.append("statut_connaissance = :statut")
        params["statut"] = statut
    if q:
        conditions.append("(nom ILIKE :q OR :q = ANY(noms_alternatifs))")
        params["q"] = f"%{q}%"

    where = " AND ".join(conditions)
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(f"""
                SELECT id, type_entite, nom, noms_alternatifs, description,
                       niveau_confiance, statut_connaissance, nb_mentions,
                       sources, attributs, premiere_mention, derniere_mention
                FROM kb_entite
                WHERE {where}
                ORDER BY derniere_mention DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        entites = [dict(r._mapping) for r in rows.fetchall()]

        total_row = await conn.execute(
            text(f"SELECT COUNT(*) FROM kb_entite WHERE {where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )
        total = total_row.scalar()

    return {"data": entites, "total": total, "limit": limit, "offset": offset}


@router.get("/entites/{entite_id}")
async def get_entite(entite_id: int):
    async with engine.connect() as conn:
        row = await conn.execute(
            text("SELECT * FROM kb_entite WHERE id = :id AND actif = true"),
            {"id": entite_id},
        )
        ent = row.fetchone()
        if not ent:
            raise HTTPException(status_code=404, detail="Entité introuvable")

        # Relations
        rels = await conn.execute(
            text("""
                SELECT r.id, r.type_relation, r.niveau_confiance, r.depuis, r.jusqua,
                       e.id as cible_id, e.nom as cible_nom, e.type_entite as cible_type
                FROM kb_relation r
                JOIN kb_entite e ON e.id = r.cible_id
                WHERE r.source_id = :id AND r.actif = true
                UNION ALL
                SELECT r.id, r.type_relation, r.niveau_confiance, r.depuis, r.jusqua,
                       e.id as cible_id, e.nom as cible_nom, e.type_entite as cible_type
                FROM kb_relation r
                JOIN kb_entite e ON e.id = r.source_id
                WHERE r.cible_id = :id AND r.actif = true
                ORDER BY niveau_confiance DESC
            """),
            {"id": entite_id},
        )

        # Journal
        journal = await conn.execute(
            text("""
                SELECT id, type_action, detail, source, agent,
                       confiance_avant, confiance_apres, date_appris
                FROM kb_apprentissage
                WHERE entite_id = :id
                ORDER BY date_appris DESC
                LIMIT 20
            """),
            {"id": entite_id},
        )

    return {
        "entite":    dict(ent._mapping),
        "relations": [dict(r._mapping) for r in rels.fetchall()],
        "journal":   [dict(j._mapping) for j in journal.fetchall()],
    }


@router.get("/graphe")
async def get_graphe(min_confiance: float = Query(0.5)):
    """Retourne nœuds + liens pour visualisation."""
    async with engine.connect() as conn:
        noeuds = await conn.execute(
            text("""
                SELECT id, type_entite, nom, niveau_confiance, statut_connaissance, nb_mentions
                FROM kb_entite
                WHERE actif = true AND niveau_confiance >= :conf
                ORDER BY nb_mentions DESC
                LIMIT 200
            """),
            {"conf": min_confiance},
        )
        liens = await conn.execute(
            text("""
                SELECT r.source_id, r.cible_id, r.type_relation, r.niveau_confiance
                FROM kb_relation r
                JOIN kb_entite s ON s.id = r.source_id AND s.actif = true
                JOIN kb_entite c ON c.id = r.cible_id AND c.actif = true
                WHERE r.actif = true AND r.niveau_confiance >= :conf
            """),
            {"conf": min_confiance},
        )

    return {
        "nodes": [dict(n._mapping) for n in noeuds.fetchall()],
        "links": [dict(l._mapping) for l in liens.fetchall()],
    }


@router.get("/apprentissage")
async def get_apprentissage(limit: int = Query(50, le=200)):
    async with engine.connect() as conn:
        rows = await conn.execute(
            text("""
                SELECT a.id, a.type_action, a.detail, a.source, a.agent,
                       a.confiance_avant, a.confiance_apres, a.date_appris,
                       e.nom as entite_nom, e.type_entite
                FROM kb_apprentissage a
                LEFT JOIN kb_entite e ON e.id = a.entite_id
                ORDER BY a.date_appris DESC
                LIMIT :limit
            """),
            {"limit": limit},
        )
    return {"data": [dict(r._mapping) for r in rows.fetchall()]}


@router.post("/analyser")
async def analyser_texte_manuel(body: dict):
    """Analyse manuelle d'un texte pour tester l'extraction."""
    texte = body.get("texte", "")
    source = body.get("source", "manuel")
    if not texte:
        raise HTTPException(status_code=400, detail="texte requis")

    from agents.connaissance.decouvreur import analyser_texte
    result = await analyser_texte(texte, source)
    return {"success": True, **result}


# ── Routes RAG — Bibliothèque analytique ────────────────────────────────────

@router.get("/rag/documents")
async def list_documents(
    type_document: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    conditions = ["1=1"]
    params: dict = {"limit": limit, "offset": offset}
    if type_document:
        conditions.append("type_document = :type_doc")
        params["type_doc"] = type_document
    where = " AND ".join(conditions)
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(f"""
                SELECT id, titre, type_document, source, url, date_publication,
                       fiabilite, themes, nb_fragments, indexe_le, ajoute_le, ajoute_par
                FROM kb_document
                WHERE {where}
                ORDER BY ajoute_le DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        docs = [dict(r._mapping) for r in rows.fetchall()]
        total_row = await conn.execute(
            text(f"SELECT COUNT(*) FROM kb_document WHERE {where}"),
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )
        total = total_row.scalar()
    return {"data": docs, "total": total}


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extrait le texte brut d'un PDF binaire via pypdf."""
    try:
        import io
        import pypdf  # type: ignore
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="pypdf non installé sur le service — pip install pypdf",
        )
    try:
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        pages = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                pages.append(text.strip())
        return "\n\n".join(pages)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Impossible d'extraire le texte du PDF : {exc}",
        )


@router.post("/rag/documents")
async def ajouter_document(body: dict):
    titre = body.get("titre", "").strip()
    if not titre:
        raise HTTPException(status_code=400, detail="titre requis")

    # Cas PDF : décoder le base64 et extraire le texte
    pdf_b64 = body.get("pdf_base64", "")
    if pdf_b64:
        import base64
        try:
            pdf_bytes = base64.b64decode(pdf_b64)
        except Exception:
            raise HTTPException(status_code=400, detail="pdf_base64 invalide (base64 mal formé)")
        texte = _extract_pdf_text(pdf_bytes)
        if not texte.strip():
            raise HTTPException(status_code=400, detail="Aucun texte extrait du PDF — le fichier est peut-être scanné (image).")
    else:
        texte = body.get("texte", "").strip()
        if not texte:
            raise HTTPException(status_code=400, detail="texte ou pdf_base64 requis")

    from agents.connaissance.rag_indexeur import indexeur_rag
    doc_id = await indexeur_rag.indexer_document(
        titre=titre,
        type_document=body.get("type_document", "RAPPORT"),
        source=body.get("source", "INTERNE"),
        texte=texte,
        date_publication=body.get("date_publication"),
        fiabilite=float(body.get("fiabilite", 0.70)),
        themes=body.get("themes", []),
        url=body.get("url"),
        ajoute_par=body.get("ajoute_par", "utilisateur"),
    )
    return {"success": True, "doc_id": doc_id, "nb_caracteres": len(texte)}


@router.delete("/rag/documents/{doc_id}")
async def supprimer_document(doc_id: int):
    from agents.connaissance.rag_indexeur import indexeur_rag
    ok = await indexeur_rag.supprimer_document(doc_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Document introuvable")
    return {"success": True}


@router.post("/rag/analyser-evenement")
async def analyser_evenement_rag(body: dict):
    if not body.get("titre"):
        raise HTTPException(status_code=400, detail="titre requis")
    from agents.connaissance.rag_analyste import analyste_contextuel
    result = await analyste_contextuel.analyser_evenement(body)
    return {"success": True, **result}


@router.get("/rag/analyses")
async def list_analyses(limit: int = Query(20, le=100)):
    async with engine.connect() as conn:
        rows = await conn.execute(
            text("""
                SELECT id, evenement_id, evenement_titre, source_agent,
                       analyse_brute, sources_utilisees, pertinence_max, created_at
                FROM kb_analyse
                ORDER BY created_at DESC
                LIMIT :limit
            """),
            {"limit": limit},
        )
    return {"data": [dict(r._mapping) for r in rows.fetchall()]}


@router.get("/rag/status")
async def rag_status():
    async with engine.connect() as conn:
        doc_count = (await conn.execute(text("SELECT COUNT(*) FROM kb_document"))).scalar()
        frag_count = (await conn.execute(text("SELECT COUNT(*) FROM kb_fragment"))).scalar()
        emb_count = (await conn.execute(
            text("SELECT COUNT(*) FROM kb_fragment WHERE embedding IS NOT NULL")
        )).scalar()
        analyse_count = (await conn.execute(text("SELECT COUNT(*) FROM kb_analyse"))).scalar()
    from .rag_indexeur import VOYAGE_API_KEY
    return {
        "documents": doc_count,
        "fragments": frag_count,
        "avec_embeddings": emb_count,
        "analyses": analyse_count,
        "mode": "vectoriel" if VOYAGE_API_KEY else "trigram",
        "voyage_api_configuree": bool(VOYAGE_API_KEY),
    }
