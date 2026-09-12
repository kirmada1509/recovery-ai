"""Provider interfaces (plan Section 9 / §18 P5-T2/T3).

Each is a `Protocol`, matching the mock/sandbox provider convention already
established for KYC, disaster signals and image analysis elsewhere in the
plan — a real provider only needs to satisfy the same shape.
"""

from typing import Protocol

from pydantic import BaseModel


class EmbeddingProvider(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class LLMProvider(Protocol):
    async def generate_structured[T: BaseModel](self, prompt: str, schema: type[T]) -> T: ...


class OcrProvider(Protocol):
    async def extract_text(self, document_hash: str) -> str | None: ...
