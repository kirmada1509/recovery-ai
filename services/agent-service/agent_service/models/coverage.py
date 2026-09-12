"""Coverage-extraction structured output (plan §18 P5-T4)."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class PolicyCitation(BaseModel):
    document_id: UUID
    chunk_id: UUID
    page_number: int | None = None
    heading: str | None = None


class CoverageFinding(BaseModel):
    item_id: UUID
    coverage: Literal["covered", "excluded", "partial", "uncertain"]
    max_payable_paise: int | None = None
    deductible_paise: int | None = None
    depreciation_paise: int | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str
    citations: list[PolicyCitation] = Field(default_factory=list)
