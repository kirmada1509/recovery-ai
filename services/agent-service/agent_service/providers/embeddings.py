"""Embedding providers (plan §18 P5-T2).

`MockEmbeddingProvider` is deterministic — a seeded hash of the chunk text,
never randomness — so re-indexing the same document produces byte-identical
vectors and tests are reproducible (CLAUDE.md invariant 10), matching the
same fixture-driven discipline used for KYC and disaster signals.
"""

import hashlib
import struct

from agent_service.db.models import EMBEDDING_DIMENSION


class MockEmbeddingProvider:
    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [_deterministic_vector(text) for text in texts]


def _deterministic_vector(text: str) -> list[float]:
    """Expands a SHA-256 digest of `text` into `EMBEDDING_DIMENSION` floats
    in [-1, 1] by hashing successive counters — same input always yields the
    same vector, different inputs yield (with overwhelming probability)
    different vectors, with no external randomness involved.
    """
    values: list[float] = []
    counter = 0
    while len(values) < EMBEDDING_DIMENSION:
        digest = hashlib.sha256(f"{text}:{counter}".encode()).digest()
        for i in range(0, len(digest) - 1, 2):
            if len(values) >= EMBEDDING_DIMENSION:
                break
            (raw,) = struct.unpack(">H", digest[i : i + 2])
            values.append((raw / 65535.0) * 2 - 1)
        counter += 1
    return values
