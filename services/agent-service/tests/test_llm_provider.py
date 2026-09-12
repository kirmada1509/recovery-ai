"""MockLLMProvider coverage-derivation behavior, and the OpenAI-compatible
adapter's retry-then-raise on invalid structured output (plan §18 P5-T3,
mocked HTTP only — never exercised with live credentials)."""

import asyncio
import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from agent_service.models.coverage import CoverageFinding
from agent_service.providers.llm import MockLLMProvider, OpenAICompatibleProvider
from recoveryai_common.runtime import AppError


def _chunk(content: str, chunk_id: str | None = None) -> dict[str, object]:
    return {
        "id": chunk_id or str(uuid.uuid4()),
        "documentId": str(uuid.uuid4()),
        "pageNumber": 1,
        "heading": "Coverage",
        "content": content,
    }


def _context(item_text: str, chunks: list[dict[str, object]], claimed_value: int = 500_00) -> str:
    return json.dumps(
        {
            "item": {
                "id": str(uuid.uuid4()),
                "description": item_text,
                "category": "furniture",
                "claimedValuePaise": claimed_value,
            },
            "chunks": chunks,
        }
    )


def test_mock_finds_covered_with_two_matching_chunks() -> None:
    provider = MockLLMProvider()
    chunks = [
        _chunk("Damaged furniture including sofas is covered under this policy."),
        _chunk("Furniture damage claims are payable up to the sum insured."),
    ]
    prompt = _context("damaged sofa furniture", chunks)
    finding = asyncio.run(provider.generate_structured(prompt, CoverageFinding))
    assert finding.coverage == "covered"
    assert len(finding.citations) >= 1
    assert all(c.chunk_id in {uuid.UUID(c2["id"]) for c2 in chunks} for c in finding.citations)


def test_mock_finds_excluded_when_exclusion_language_matches() -> None:
    provider = MockLLMProvider()
    chunks = [_chunk("Furniture damage due to normal wear is excluded from coverage.")]
    prompt = _context("furniture damage", chunks)
    finding = asyncio.run(provider.generate_structured(prompt, CoverageFinding))
    assert finding.coverage == "excluded"
    assert finding.max_payable_paise == 0


def test_mock_is_uncertain_with_no_matching_chunks() -> None:
    provider = MockLLMProvider()
    chunks = [_chunk("Coverage for electronics and gadgets is described here.")]
    prompt = _context("damaged sofa furniture", chunks)
    finding = asyncio.run(provider.generate_structured(prompt, CoverageFinding))
    assert finding.coverage == "uncertain"


def test_mock_is_deterministic() -> None:
    provider = MockLLMProvider()
    chunks = [_chunk("Furniture is covered under this policy.")]
    prompt = _context("damaged sofa furniture", chunks)
    first = asyncio.run(provider.generate_structured(prompt, CoverageFinding))
    second = asyncio.run(provider.generate_structured(prompt, CoverageFinding))
    assert first == second


@patch("agent_service.providers.llm.httpx.AsyncClient")
def test_openai_compatible_retries_once_then_raises_on_invalid_output(
    mock_client_cls: AsyncMock,
) -> None:
    mock_client = AsyncMock()
    mock_response = AsyncMock()
    mock_response.raise_for_status = lambda: None
    mock_response.json = lambda: {"choices": [{"message": {"content": "not valid json"}}]}
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client_cls.return_value.__aenter__.return_value = mock_client

    provider = OpenAICompatibleProvider(
        base_url="https://example.invalid/v1", api_key="test-key", model="test-model"
    )

    with pytest.raises(AppError) as exc_info:
        asyncio.run(provider.generate_structured("prompt", CoverageFinding))

    assert exc_info.value.code == "LLM_STRUCTURED_OUTPUT_INVALID"
    assert mock_client.post.call_count == 2
