"""
Abstract base connector with circuit-breaker and retry logic.
"""
from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from datetime import datetime

import structlog

from schemas.events import CanonicalEvent, RawEvent

logger = structlog.get_logger(__name__)

_CIRCUIT_OPEN_SECONDS = 3600  # 1 hour before auto-reset


class AbstractConnector(ABC):
    source_id: str = ""
    fetch_interval_minutes: int = 60
    max_retries: int = 3
    circuit_breaker_threshold: int = 5

    def __init__(self) -> None:
        self._consecutive_failures: int = 0
        self._circuit_open: bool = False
        self._circuit_opened_at: datetime | None = None

    @abstractmethod
    async def fetch(self) -> list[RawEvent]:
        """Fetch raw events from the external source."""
        ...

    @abstractmethod
    async def normalize(self, raw: RawEvent) -> CanonicalEvent:
        """Normalize a raw event into a canonical event."""
        ...

    async def health_check(self) -> bool:
        """Return True if the connector is healthy (circuit not open)."""
        if self._circuit_open and self._circuit_opened_at is not None:
            elapsed = (datetime.utcnow() - self._circuit_opened_at).total_seconds()
            if elapsed >= _CIRCUIT_OPEN_SECONDS:
                logger.info(
                    "circuit_breaker.auto_reset",
                    source=self.source_id,
                    elapsed_seconds=elapsed,
                )
                self._circuit_open = False
                self._consecutive_failures = 0
        return not self._circuit_open

    def record_success(self) -> None:
        self._consecutive_failures = 0
        self._circuit_open = False

    def record_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= self.circuit_breaker_threshold:
            self._circuit_open = True
            self._circuit_opened_at = datetime.utcnow()
            logger.warning(
                "circuit_breaker.opened",
                source=self.source_id,
                failures=self._consecutive_failures,
            )

    async def fetch_with_retry(self) -> list[RawEvent]:
        """
        Fetch with exponential back-off retries.
        If the circuit breaker is open and < 1 h has passed, raises immediately.
        """
        healthy = await self.health_check()
        if not healthy:
            raise RuntimeError(
                f"Circuit breaker open for connector '{self.source_id}'. "
                "Skipping fetch until auto-reset."
            )

        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                events = await self.fetch()
                self.record_success()
                logger.info(
                    "connector.fetch_success",
                    source=self.source_id,
                    count=len(events),
                    attempt=attempt,
                )
                return events
            except Exception as exc:
                last_exc = exc
                self.record_failure()
                wait = 2 ** (attempt - 1)  # 1s, 2s, 4s
                logger.warning(
                    "connector.fetch_retry",
                    source=self.source_id,
                    attempt=attempt,
                    max_retries=self.max_retries,
                    error=str(exc),
                    wait_seconds=wait,
                )
                if attempt < self.max_retries:
                    await asyncio.sleep(wait)

        raise RuntimeError(
            f"Connector '{self.source_id}' failed after {self.max_retries} attempts: {last_exc}"
        ) from last_exc
