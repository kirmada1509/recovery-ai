"""Retrieval always filters by policy_id (plan §18 P5-T2, ADR-0004)."""

import uuid

from agent_service.db.models import PolicyChunk
from agent_service.db.session import create_session_factory
from agent_service.retrieval import retrieve

TEST_DATABASE_URL = "postgresql://recoveryai:recoveryai@localhost:5432/recoveryai_agent"


def _vector(seed: float) -> list[float]:
    # Cosine distance only cares about direction, so a uniform vector
    # ([seed] * 384) is useless here — every positive uniform vector points
    # the same direction regardless of magnitude. Splitting into two halves
    # with different weights gives each seed a genuinely different
    # direction to compare against.
    half = 192
    return [seed] * half + [1.0 - seed] * (384 - half)


async def _seed() -> tuple[uuid.UUID, uuid.UUID]:
    policy_a = uuid.uuid4()
    policy_b = uuid.uuid4()
    session_factory = create_session_factory(TEST_DATABASE_URL)
    async with session_factory() as session, session.begin():
        session.add(
            PolicyChunk(
                policy_id=policy_a,
                document_id=uuid.uuid4(),
                chunk_index=0,
                content="Policy A clause about furniture",
                embedding=_vector(0.1),
            )
        )
        session.add(
            PolicyChunk(
                policy_id=policy_b,
                document_id=uuid.uuid4(),
                chunk_index=0,
                content="Policy B clause about electronics",
                embedding=_vector(0.9),
            )
        )
    return policy_a, policy_b


def test_retrieve_only_returns_chunks_for_the_given_policy() -> None:
    import asyncio

    policy_a, policy_b = asyncio.run(_seed())

    async def run() -> list[PolicyChunk]:
        session_factory = create_session_factory(TEST_DATABASE_URL)
        async with session_factory() as session:
            return await retrieve(session, policy_id=policy_a, query_embedding=_vector(0.1), k=5)

    results = asyncio.run(run())
    assert len(results) == 1
    assert results[0].policy_id == policy_a
    assert all(chunk.policy_id != policy_b for chunk in results)


def test_retrieve_orders_by_similarity() -> None:
    import asyncio

    policy_id = uuid.uuid4()

    async def seed_and_query() -> list[PolicyChunk]:
        session_factory = create_session_factory(TEST_DATABASE_URL)
        async with session_factory() as session, session.begin():
            session.add(
                PolicyChunk(
                    policy_id=policy_id,
                    document_id=uuid.uuid4(),
                    chunk_index=0,
                    content="far",
                    embedding=_vector(0.9),
                )
            )
            session.add(
                PolicyChunk(
                    policy_id=policy_id,
                    document_id=uuid.uuid4(),
                    chunk_index=1,
                    content="near",
                    embedding=_vector(0.11),
                )
            )
        async with session_factory() as session:
            return await retrieve(session, policy_id=policy_id, query_embedding=_vector(0.1), k=5)

    results = asyncio.run(seed_and_query())
    assert results[0].content == "near"
