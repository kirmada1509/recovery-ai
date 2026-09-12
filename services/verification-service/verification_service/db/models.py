"""SQLAlchemy models (plan Section 6.5).

`overall_score`/`score`/`weight` are `NUMERIC` deliberately — these are
0.0-1.0 confidence scores, not money, so CLAUDE.md's "money is integer paise"
invariant does not apply here.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Numeric,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class VerificationRun(Base):
    __tablename__ = "verification_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    overall_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    decision: Mapped[str | None] = mapped_column(String)
    reasons: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    ruleset_version: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    signals: Mapped[list["VerificationSignal"]] = relationship(back_populates="run")


class VerificationSignal(Base):
    __tablename__ = "verification_signals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("verification_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    signal_type: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    score: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)
    weight: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)
    result: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    evidence_refs: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    run: Mapped["VerificationRun"] = relationship(back_populates="signals")
