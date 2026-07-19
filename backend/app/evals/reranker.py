"""Re-ranking module for improving retrieval quality.

Implements a cross-encoder reranker that rescores candidate documents
retrieved from the vector store against the original query, producing
a more accurate relevance ordering.
"""

import logging
from langchain_core.documents import Document

from app.llm import get_llm

logger = logging.getLogger(__name__)

_cross_encoder = None


def get_cross_encoder():
    """Lazy-load a cross-encoder model for reranking."""
    global _cross_encoder
    if _cross_encoder is None:
        try:
            from sentence_transformers import CrossEncoder
            _cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
            logger.info("Cross-encoder loaded for reranking.")
        except Exception as e:
            logger.warning("Cross-encoder unavailable, using LLM fallback: %s", e)
    return _cross_encoder


def rerank_with_cross_encoder(
    query: str, documents: list[Document], top_k: int = 5
) -> list[tuple[Document, float]]:
    """Rerank documents using a cross-encoder model.

    Returns (document, score) tuples sorted by descending relevance.
    """
    encoder = get_cross_encoder()
    if encoder is None:
        return [(doc, 1.0 / (i + 1)) for i, doc in enumerate(documents[:top_k])]

    pairs = [(query, doc.page_content) for doc in documents]
    scores = encoder.predict(pairs)

    scored = list(zip(documents, scores))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


def rerank_with_llm(
    query: str, documents: list[Document], top_k: int = 5
) -> list[tuple[Document, float]]:
    """Rerank documents using an LLM to score relevance.

    Fallback when cross-encoder is unavailable. Uses the LLM to rate
    each document's relevance to the query on a 0-10 scale.
    """
    if not documents:
        return []

    llm = get_llm(temperature=0.0)
    scored: list[tuple[Document, float]] = []

    for doc in documents[:top_k * 2]:
        title = doc.metadata.get("title", "untitled")
        prompt = (
            f"Rate the relevance of this document to the query on a scale of 0-10.\n"
            f"Query: {query}\n"
            f"Document title: {title}\n"
            f"Document: {doc.page_content[:500]}\n\n"
            f"Reply with ONLY a number 0-10."
        )
        try:
            response = llm.invoke(prompt)
            score = float(response.content.strip())
            scored.append((doc, score / 10.0))
        except (ValueError, AttributeError):
            scored.append((doc, 0.5))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


def rerank(
    query: str, documents: list[Document], top_k: int = 5
) -> list[tuple[Document, float]]:
    """Rerank documents using the best available method.

    Cross-encoder only. Does NOT fall back to per-doc LLM scoring (that path
    stalled analyze for 10+ minutes when sentence-transformers was unavailable).
    """
    encoder = get_cross_encoder()
    if encoder is not None:
        return rerank_with_cross_encoder(query, documents, top_k)
    logger.warning("Cross-encoder unavailable; using vector order (no LLM rerank).")
    return [(doc, 1.0 / (i + 1)) for i, doc in enumerate(documents[:top_k])]


def rechunk_documents(
    documents: list[Document], chunk_size: int = 500, overlap: int = 50
) -> list[Document]:
    """Re-chunk documents into smaller, overlapping segments.

    Useful when the original documents are too long for effective
    embedding similarity search.
    """
    rechunked: list[Document] = []
    for doc in documents:
        text = doc.page_content
        if len(text) <= chunk_size:
            rechunked.append(doc)
            continue

        start = 0
        chunk_idx = 0
        while start < len(text):
            end = start + chunk_size
            chunk_text = text[start:end]
            chunk_doc = Document(
                page_content=chunk_text,
                metadata={
                    **doc.metadata,
                    "chunk_index": chunk_idx,
                    "original_title": doc.metadata.get("title", ""),
                },
            )
            rechunked.append(chunk_doc)
            start = end - overlap
            chunk_idx += 1

    logger.info(
        "Rechunked %d documents into %d chunks (size=%d, overlap=%d)",
        len(documents), len(rechunked), chunk_size, overlap,
    )
    return rechunked


def reingest_with_reranking(
    query: str, store, k_retrieve: int = 10, k_final: int = 3
) -> list[Document]:
    """Retrieve, rerank, and return the best documents for a query.

    1. Retrieve a broad set (k_retrieve) from the vector store
    2. Rerank with cross-encoder or LLM
    3. Return top k_final
    """
    candidates = store.similarity_search(query, k=k_retrieve)
    if not candidates:
        return []

    reranked = rerank(query, candidates, top_k=k_final)
    return [doc for doc, _score in reranked]
