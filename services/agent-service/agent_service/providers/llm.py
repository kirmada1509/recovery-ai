"""LLM providers (plan Section 9.3 / §18 P5-T3).

`generate_structured` returns a validated Pydantic model, never prose to be
regex'd apart — "reject/retry invalid structured output" per plan §9.3.
`MockLLMProvider` is deterministic (CLAUDE.md invariant 10): coverage
findings are derived from the claim snapshot's own fields and keyword
overlap with retrieved policy chunks, never a real model call. It is the
only schema the mock currently supports — the prompt for it is JSON built
by `coverage_extraction.py`, not free text.
"""

import json
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError
from recoveryai_common.runtime import AppError

from agent_service.models.coverage import CoverageFinding, PolicyCitation

# Excluding is intentionally rarer than partial/covered in the mock: an
# absence of any policy-chunk keyword overlap is treated as uncertainty
# about coverage, not proof of exclusion — a real LLM must reason about
# actual exclusion clauses, which the mock cannot do without a fixture.
_EXCLUSION_KEYWORDS = ("exclude", "excluded", "not covered", "exclusion")


def _keyword_overlap(item_text: str, chunk_text: str) -> int:
    item_words = {w for w in item_text.lower().split() if len(w) > 3}
    chunk_words = {w for w in chunk_text.lower().split() if len(w) > 3}
    return len(item_words & chunk_words)


class MockLLMProvider:
    async def generate_structured[T: BaseModel](self, prompt: str, schema: type[T]) -> T:
        if schema is not CoverageFinding:
            raise NotImplementedError("MockLLMProvider only supports CoverageFinding in this phase")
        context = json.loads(prompt)
        return _mock_coverage_finding(context)  # type: ignore[return-value]


def _mock_coverage_finding(context: dict[str, Any]) -> CoverageFinding:
    item = context["item"]
    chunks: list[dict[str, Any]] = context["chunks"]
    item_text = f"{item['description']} {item['category']}"

    scored = [(chunk, _keyword_overlap(item_text, chunk["content"])) for chunk in chunks]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    matched = [chunk for chunk, score in scored if score > 0]

    any_exclusion_language = any(
        keyword in chunk["content"].lower()
        for chunk in chunks
        for keyword in _EXCLUSION_KEYWORDS
        if _keyword_overlap(item_text, chunk["content"]) > 0
    )

    claimed_value_paise = int(item["claimedValuePaise"])

    if not matched:
        coverage = "uncertain"
        confidence = 0.3
        max_payable = None
        rationale = "No policy clause matched this item's description or category."
        citation_chunks = chunks[:1]
    elif any_exclusion_language:
        coverage = "excluded"
        confidence = 0.75
        max_payable = 0
        rationale = "A matched policy clause contains exclusion language for this item."
        citation_chunks = matched[:2]
    elif len(matched) >= 2:
        coverage = "covered"
        confidence = 0.9
        max_payable = claimed_value_paise
        rationale = "Multiple policy clauses corroborate coverage for this item."
        citation_chunks = matched[:2]
    else:
        coverage = "partial"
        confidence = 0.6
        max_payable = claimed_value_paise
        rationale = "One policy clause partially matches this item; coverage is not fully certain."
        citation_chunks = matched[:1]

    citations = [
        PolicyCitation(
            document_id=chunk["documentId"],
            chunk_id=chunk["id"],
            page_number=chunk.get("pageNumber"),
            heading=chunk.get("heading"),
        )
        for chunk in citation_chunks
    ]

    return CoverageFinding(
        item_id=item["id"],
        coverage=coverage,  # type: ignore[arg-type]
        max_payable_paise=max_payable,
        deductible_paise=0,
        depreciation_paise=0,
        confidence=confidence,
        rationale=rationale,
        citations=citations,
    )


class OpenAICompatibleProvider:
    """Real adapter (plan §9.3): OpenAI-compatible chat completions with
    structured-output enforcement. Retries once on invalid structured
    output, then raises — never falls back to regexing prose. Not exercised
    with live credentials by any test (plan §9.7); a stubbed-HTTP test
    covers only the retry-then-raise path.
    """

    def __init__(self, *, base_url: str, api_key: str, model: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model

    async def generate_structured[T: BaseModel](self, prompt: str, schema: type[T]) -> T:
        last_error: Exception | None = None
        for _attempt in range(2):
            try:
                raw = await self._call(prompt, schema)
                return schema.model_validate_json(raw)
            except (ValidationError, ValueError) as exc:
                last_error = exc
        raise AppError(
            "LLM_STRUCTURED_OUTPUT_INVALID",
            "LLM did not return valid structured output after retry",
            502,
            details={"error": str(last_error)},
        )

    async def _call(self, prompt: str, schema: type[BaseModel]) -> str:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self._base_url}/chat/completions",
                headers={"authorization": f"Bearer {self._api_key}"},
                json={
                    "model": self._model,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": schema.__name__,
                            "schema": schema.model_json_schema(),
                        },
                    },
                },
            )
            response.raise_for_status()
            body = response.json()
            content: str = body["choices"][0]["message"]["content"]
            return content
