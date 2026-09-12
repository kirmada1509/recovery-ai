"""Mock embedding determinism (plan §18 P5-T2 / CLAUDE.md invariant 10)."""

import asyncio

from agent_service.db.models import EMBEDDING_DIMENSION
from agent_service.providers.embeddings import MockEmbeddingProvider


def test_same_text_produces_the_same_vector() -> None:
    provider = MockEmbeddingProvider()
    first = asyncio.run(provider.embed(["Damaged sofa in the living room"]))
    second = asyncio.run(provider.embed(["Damaged sofa in the living room"]))
    assert first == second


def test_different_text_produces_different_vectors() -> None:
    provider = MockEmbeddingProvider()
    [a, b] = asyncio.run(provider.embed(["Damaged sofa", "Flooded kitchen"]))
    assert a != b


def test_vectors_have_the_configured_dimension() -> None:
    provider = MockEmbeddingProvider()
    [vector] = asyncio.run(provider.embed(["Any text"]))
    assert len(vector) == EMBEDDING_DIMENSION
    assert all(-1.0 <= v <= 1.0 for v in vector)
