"""SQLAlchemy models (plan Section 6.7, agent-service subset).

Only `agent_runs` and `policy_chunks` exist for Phase 5. The
`negotiation_sessions` / `negotiation_rounds` / `negotiation_item_ledger` /
`negotiation_blocked_moves` tables from Section 6.7 are deliberately not
created here — nothing populates them until Phase 7 wires the real
negotiation loop (matching the precedent Phase 3 already set by skipping
`negotiation_mandates`). Section 10's value model and item ledger exist this
phase only as pure in-memory functions (`negotiation/`).
"""

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# The mock embedding provider's fixed output size (`providers/embeddings.py`).
# A real embedding provider must produce vectors of this same dimension —
# the column type is not generic, so switching providers without matching
# dimensionality is a schema migration, not a config change.
EMBEDDING_DIMENSION = 384


class Base(DeclarativeBase):
    pass


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    workflow_name: Mapped[str] = mapped_column(String, nullable=False)
    workflow_version: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="running")
    current_node: Mapped[str | None] = mapped_column(String)
    wait_reason: Mapped[str | None] = mapped_column(String)
    error_code: Mapped[str | None] = mapped_column(String)
    # The hand-rolled checkpoint (plan §9.1 "resumable at every wait point")
    # — persisted after every node transition regardless of which graph
    # library backs the workflow, so a resume never depends on an external
    # checkpointer being reachable.
    state: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PolicyChunk(Base):
    __tablename__ = "policy_chunks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Retrieval always filters by `policy_id` (ADR-0004: one Postgres, one
    # pgvector extension, never a query across policies).
    policy_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer)
    heading: Mapped[str | None] = mapped_column(String)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIMENSION), nullable=False)
    chunk_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
