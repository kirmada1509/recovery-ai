"""Per-item coverage extraction (plan §18 P5-T4).

Citations are never trusted from the LLM's own output — the chunk ids it
can possibly cite are exactly the ones retrieved and passed into the
prompt, and that is asserted here, not merely hoped for.
"""

import json
import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from agent_service.db.models import PolicyChunk
from agent_service.models.coverage import CoverageFinding
from agent_service.providers.base import EmbeddingProvider, LLMProvider
from agent_service.retrieval import retrieve

TOP_K_CHUNKS = 5


@dataclass(frozen=True)
class ClaimItemInput:
    id: uuid.UUID
    description: str
    category: str
    claimed_value_paise: int


def _chunk_to_context(chunk: PolicyChunk) -> dict[str, object]:
    return {
        "id": str(chunk.id),
        "documentId": str(chunk.document_id),
        "pageNumber": chunk.page_number,
        "heading": chunk.heading,
        "content": chunk.content,
    }


async def extract_coverage_for_item(
    session: AsyncSession,
    *,
    policy_id: uuid.UUID,
    item: ClaimItemInput,
    embedding_provider: EmbeddingProvider,
    llm_provider: LLMProvider,
) -> CoverageFinding:
    (query_embedding,) = await embedding_provider.embed([f"{item.description} {item.category}"])
    retrieved = await retrieve(
        session, policy_id=policy_id, query_embedding=query_embedding, k=TOP_K_CHUNKS
    )
    retrieved_ids = {chunk.id for chunk in retrieved}

    prompt = json.dumps(
        {
            "item": {
                "id": str(item.id),
                "description": item.description,
                "category": item.category,
                "claimedValuePaise": item.claimed_value_paise,
            },
            "chunks": [_chunk_to_context(chunk) for chunk in retrieved],
        }
    )

    finding = await llm_provider.generate_structured(prompt, CoverageFinding)

    # A citation naming a chunk that was never retrieved for this item is a
    # fabrication, not a citation — never trust the LLM's own claim.
    for citation in finding.citations:
        if citation.chunk_id not in retrieved_ids:
            raise ValueError(
                f"LLM cited chunk {citation.chunk_id} that was not retrieved for item {item.id}"
            )

    return finding
