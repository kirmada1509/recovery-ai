"""Shared test setup: real Postgres (recoveryai_agent), same "tests hit real
Postgres, not mocks" rule the other services follow."""

import asyncio

import pytest
from agent_service.db.models import AgentRun, PolicyChunk
from agent_service.db.session import create_session_factory
from sqlalchemy import delete

TEST_DATABASE_URL = "postgresql://recoveryai:recoveryai@localhost:5432/recoveryai_agent"


async def _reset_db() -> None:
    session_factory = create_session_factory(TEST_DATABASE_URL)
    async with session_factory() as session, session.begin():
        await session.execute(delete(PolicyChunk))
        await session.execute(delete(AgentRun))


@pytest.fixture(autouse=True)
def _clean_database() -> None:
    asyncio.run(_reset_db())
