"""Readiness checks (plan Section 4.5)."""

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import asyncpg


@dataclass
class ReadinessCheck:
    name: str
    run: Callable[[], Awaitable[None]]
    optional: bool = False


@dataclass
class ReadinessRegistry:
    checks: list[ReadinessCheck] = field(default_factory=list)

    def register(self, check: ReadinessCheck) -> "ReadinessRegistry":
        self.checks.append(check)
        return self

    async def run(self) -> tuple[bool, list[dict[str, Any]]]:
        results: list[dict[str, Any]] = []
        ready = True
        for check in self.checks:
            started = time.perf_counter()
            try:
                await check.run()
                results.append(
                    {
                        "name": check.name,
                        "ok": True,
                        "durationMs": round((time.perf_counter() - started) * 1000),
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "name": check.name,
                        "ok": False,
                        "detail": str(exc),
                        "durationMs": round((time.perf_counter() - started) * 1000),
                    }
                )
                if not check.optional:
                    ready = False
        return ready, results


def postgres_readiness_check(database_url: str) -> ReadinessCheck:
    """A real round-trip to Postgres; a readiness probe that cannot fail is worthless."""

    async def run() -> None:
        connection = await asyncpg.connect(dsn=database_url, timeout=5)
        try:
            await connection.execute("select 1")
        finally:
            await connection.close()

    return ReadinessCheck(name="postgres", run=run)
