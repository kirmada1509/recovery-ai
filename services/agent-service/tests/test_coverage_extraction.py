"""Coverage extraction citation integrity (plan §18 P5-T4): a citation always
traces to a chunk that was actually retrieved for that item, never a
fabricated id — real Postgres, real retrieval, mock embeddings/LLM."""

import asyncio
import uuid

from agent_service.coverage_extraction import ClaimItemInput, extract_coverage_for_item
from agent_service.db.models import PolicyChunk
from agent_service.db.session import create_session_factory
from agent_service.providers.embeddings import MockEmbeddingProvider
from agent_service.providers.llm import MockLLMProvider

TEST_DATABASE_URL = "postgresql://recoveryai:recoveryai@localhost:5432/recoveryai_agent"


async def _seed_policy_chunks(policy_id: uuid.UUID) -> None:
    provider = MockEmbeddingProvider()
    contents = [
        "Damage to furniture including sofas and chairs is covered up to the sum insured.",
        "Electronics and gadgets are covered separately under an optional rider.",
        "Furniture damage caused by termites is excluded from this policy.",
    ]
    embeddings = await provider.embed(contents)
    session_factory = create_session_factory(TEST_DATABASE_URL)
    async with session_factory() as session, session.begin():
        for i, (content, embedding) in enumerate(zip(contents, embeddings, strict=True)):
            session.add(
                PolicyChunk(
                    policy_id=policy_id,
                    document_id=uuid.uuid4(),
                    chunk_index=i,
                    content=content,
                    embedding=embedding,
                )
            )


def test_citations_always_trace_to_retrieved_chunks() -> None:
    policy_id = uuid.uuid4()
    asyncio.run(_seed_policy_chunks(policy_id))

    async def run() -> None:
        session_factory = create_session_factory(TEST_DATABASE_URL)
        async with session_factory() as session:
            item = ClaimItemInput(
                id=uuid.uuid4(),
                description="Damaged sofa",
                category="furniture",
                claimed_value_paise=500_00,
            )
            finding = await extract_coverage_for_item(
                session,
                policy_id=policy_id,
                item=item,
                embedding_provider=MockEmbeddingProvider(),
                llm_provider=MockLLMProvider(),
            )

            result = await session.execute(
                PolicyChunk.__table__.select().where(PolicyChunk.policy_id == policy_id)
            )
            all_chunk_ids = {row.id for row in result}
            for citation in finding.citations:
                assert citation.chunk_id in all_chunk_ids
            assert finding.item_id == item.id

    asyncio.run(run())
