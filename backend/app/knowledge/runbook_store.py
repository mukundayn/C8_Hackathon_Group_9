import logging
import os
from typing import Optional, Union

from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings, HuggingFaceEndpointEmbeddings
from langchain_core.documents import Document

from app.config import config
from app.knowledge.runbook_seed import RUNBOOKS

logger = logging.getLogger(__name__)

_embeddings: Union[HuggingFaceEmbeddings, HuggingFaceEndpointEmbeddings, None] = None
_store: Chroma | None = None


def _get_embeddings() -> Union[HuggingFaceEmbeddings, HuggingFaceEndpointEmbeddings]:
    global _embeddings
    if _embeddings is None:
        hf_token = os.getenv("HF_TOKEN", "")
        if hf_token:
            # Production (Render): use HF Inference API — no local model download.
            # This avoids loading PyTorch + sentence-transformers (~400MB) locally,
            # keeping RAM well within the 512MB free-tier limit.
            logger.info("[embeddings] Using HuggingFace Inference API (HF_TOKEN set).")
            _embeddings = HuggingFaceEndpointEmbeddings(
                model=config.EMBEDDING_MODEL,
                huggingfacehub_api_token=hf_token,
            )
        else:
            # Local dev: download + run the model on this machine.
            logger.info("[embeddings] Using local sentence-transformers (no HF_TOKEN).")
            _embeddings = HuggingFaceEmbeddings(model_name=config.EMBEDDING_MODEL)
    return _embeddings


def get_store() -> Chroma:
    global _store
    if _store is None:
        _store = Chroma(
            collection_name="runbooks",
            embedding_function=_get_embeddings(),
            persist_directory=config.CHROMA_DIR,
        )
    return _store


def _rebuild_bm25_from_store() -> None:
    """Best-effort BM25 rebuild so hybrid search works after seed / cold start."""
    try:
        from app.knowledge.hybrid_retriever import rebuild_bm25_index

        store = get_store()
        raw = store.get(include=["documents", "metadatas"])
        docs: list[Document] = []
        for content, meta in zip(raw.get("documents") or [], raw.get("metadatas") or []):
            if content:
                docs.append(Document(page_content=content, metadata=meta or {}))
        rebuild_bm25_index(docs)
    except Exception as e:
        logger.warning("BM25 rebuild skipped: %s", e)


def seed_if_empty() -> int:
    """Populate the vector DB with the curated runbook corpus if it's empty.

    Returns the number of documents added (0 if already seeded).
    """
    store = get_store()
    existing = store.get()  # {'ids': [...], ...}
    if existing and existing.get("ids"):
        logger.info("Runbook store already seeded (%d docs).", len(existing["ids"]))
        _rebuild_bm25_from_store()
        return 0

    docs = [
        Document(
            page_content=rb["content"],
            metadata={
                "title": rb["title"],
                "category": rb["category"],
                "service_hint": rb.get("service_hint", ""),
            },
        )
        for rb in RUNBOOKS
    ]
    store.add_documents(docs)
    logger.info("Seeded runbook store with %d docs.", len(docs))
    _rebuild_bm25_from_store()
    return len(docs)


def retrieve_with_scores(
    query: str,
    k: int | None = None,
    filters: Optional[dict[str, str]] = None,
    use_hybrid: bool = True,
    use_rerank: bool = True,
) -> list[tuple[Document, float]]:
    """Return (document, score) pairs for confidence evaluation / remediations.

    Pipeline: vector search → optional hybrid (BM25+RRF) → optional rerank.
    """
    top_k = k or config.RAG_TOP_K
    candidate_k = max(top_k, config.RAG_CANDIDATE_K)
    store = get_store()

    # Optional metadata filter (category / service_hint) when provided.
    where = None
    if filters:
        # Chroma where-clause: single equality or $and of equalities.
        clauses = [{key: value} for key, value in filters.items() if value]
        if len(clauses) == 1:
            where = clauses[0]
        elif len(clauses) > 1:
            where = {"$and": clauses}

    try:
        if where:
            vector_docs = store.similarity_search(query, k=candidate_k, filter=where)
        else:
            vector_docs = store.similarity_search(query, k=candidate_k)
    except Exception as e:
        logger.warning("Filtered search failed (%s); falling back to unfiltered.", e)
        vector_docs = store.similarity_search(query, k=candidate_k)

    docs = vector_docs
    if use_hybrid:
        try:
            from app.knowledge.hybrid_retriever import hybrid_search, index_ready

            if not index_ready():
                _rebuild_bm25_from_store()
            docs = hybrid_search(query, vector_docs, k=candidate_k)
        except Exception as e:
            logger.warning("Hybrid search failed; using vector-only: %s", e)
            docs = vector_docs

    if use_rerank and docs:
        try:
            from app.evals.reranker import rerank

            return rerank(query, docs, top_k=top_k)
        except Exception as e:
            logger.warning("Rerank failed; returning vector order: %s", e)

    # Synthetic descending scores when rerank is off / unavailable.
    return [(doc, 1.0 / (i + 1)) for i, doc in enumerate(docs[:top_k])]


def retrieve(
    query: str,
    k: int | None = None,
    use_hybrid: bool = False,
    use_rerank: bool = False,
    filters: Optional[dict[str, str]] = None,
) -> list[Document]:
    """Return the top-k most similar runbooks for a query string."""
    scored = retrieve_with_scores(
        query,
        k=k,
        filters=filters,
        use_hybrid=use_hybrid,
        use_rerank=use_rerank,
    )
    return [doc for doc, _ in scored]
