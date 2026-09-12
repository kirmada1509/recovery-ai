"""Policy extraction -> chunking -> embedding -> persistence (plan §18 P5-T2)."""

import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from agent_service.chunking import chunk_pages
from agent_service.db.models import PolicyChunk
from agent_service.providers.base import EmbeddingProvider
from agent_service.providers.ocr import MockOcrProvider
from agent_service.providers.text_extraction import extract_pages


async def index_policy(
    session: AsyncSession,
    *,
    policy_id: uuid.UUID,
    document_id: uuid.UUID,
    pdf_bytes: bytes,
    embedding_provider: EmbeddingProvider,
    ocr_provider: MockOcrProvider,
) -> int:
    """Replaces `policy_id`'s existing chunks with freshly extracted ones.
    Participates in the caller's own transaction (autobegun on the session)
    rather than opening its own, so a re-index is atomic with whatever else
    the caller commits alongside it — never a mix of old and new chunks
    visible to a concurrent retrieval once that commit lands.
    """
    pages = await extract_pages(pdf_bytes, ocr_provider)
    chunks = chunk_pages(pages)

    contents = [chunk.content for chunk in chunks]
    embeddings = await embedding_provider.embed(contents) if contents else []

    await session.execute(delete(PolicyChunk).where(PolicyChunk.policy_id == policy_id))
    for chunk, embedding in zip(chunks, embeddings, strict=True):
        session.add(
            PolicyChunk(
                policy_id=policy_id,
                document_id=document_id,
                chunk_index=chunk.chunk_index,
                content=chunk.content,
                page_number=chunk.page_number,
                heading=chunk.heading,
                embedding=embedding,
            )
        )

    return len(chunks)
