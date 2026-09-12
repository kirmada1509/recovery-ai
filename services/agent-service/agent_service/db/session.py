"""Async SQLAlchemy engine/session factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


def _to_asyncpg_url(database_url: str) -> str:
    """`postgresql://...` (the shared convention) -> `postgresql+asyncpg://...`."""
    if database_url.startswith("postgresql+asyncpg://"):
        return database_url
    return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)


def create_session_factory(database_url: str) -> async_sessionmaker[AsyncSession]:
    # `NullPool`: a pooled asyncpg connection is bound to the event loop it
    # was first opened on, which breaks the moment two different loops touch
    # it (e.g. Starlette's TestClient portal vs. a plain `asyncio.run()` in a
    # test's setup step) with "attached to a different loop". A fresh
    # connection per checkout costs little at this service's scale and
    # sidesteps the whole class of bug.
    engine = create_async_engine(_to_asyncpg_url(database_url), poolclass=NullPool)
    return async_sessionmaker(engine, expire_on_commit=False)


@asynccontextmanager
async def session_scope(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session, session.begin():
        yield session
