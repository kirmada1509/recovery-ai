"""Policy chunk retrieval (plan §18 P5-T2, ADR-0004).

Every retrieval is filtered by `policy_id` — pgvector is one extension on
one shared Postgres, not a separate vector database, so nothing but the
`WHERE` clause stops a query from crossing policies.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent_service.db.models import PolicyChunk


async def retrieve(
    session: AsyncSession,
    *,
    policy_id: uuid.UUID,
    query_embedding: list[float],
    k: int = 5,
) -> list[PolicyChunk]:
    stmt = (
        select(PolicyChunk)
        .where(PolicyChunk.policy_id == policy_id)
        .order_by(PolicyChunk.embedding.cosine_distance(query_embedding))
        .limit(k)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())
