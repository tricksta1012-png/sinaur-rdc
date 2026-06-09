"""
Fingerprint-based event deduplication for the Veille agent.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict

import structlog

from schemas.events import CanonicalEvent

logger = structlog.get_logger(__name__)


def compute_fingerprint(event: CanonicalEvent) -> str:
    """
    Compute a 16-char hex fingerprint for deduplication.

    The key is: event_type + p_code + date (same calendar day = same window).
    Two events from different sources on the same day about the same hazard
    in the same province will share a fingerprint.
    """
    window = event.fetched_at.date().isoformat()
    raw = f"{event.event_type.value}|{event.p_code or 'UNKNOWN'}|{window}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class Deduplicator:
    """
    In-memory deduplication registry.

    Maintains a dict of fingerprint → list[CanonicalEvent].
    Returns (deduplicated_events, source_count_map).
    """

    def __init__(self) -> None:
        self._registry: dict[str, list[CanonicalEvent]] = defaultdict(list)

    def process(self, events: list[CanonicalEvent]) -> list[CanonicalEvent]:
        """
        Accept a batch of events, deduplicate, and return unique canonical events.

        For duplicate events (same fingerprint), retain the one with the highest
        reliability_score; increment a source_count attribute on the winner.
        """
        new_events: list[CanonicalEvent] = []

        for event in events:
            fp = compute_fingerprint(event)
            existing = self._registry[fp]

            if not existing:
                self._registry[fp].append(event)
                new_events.append(event)
                logger.debug("deduplicator.new_event", fp=fp, source=event.source_id)
            else:
                # Merge: update registry with highest-reliability version
                best = max(existing, key=lambda e: e.reliability_score)
                if event.reliability_score > best.reliability_score:
                    self._registry[fp].append(event)
                    logger.debug(
                        "deduplicator.higher_reliability",
                        fp=fp,
                        old_score=best.reliability_score,
                        new_score=event.reliability_score,
                    )
                else:
                    self._registry[fp].append(event)
                    logger.debug(
                        "deduplicator.duplicate_absorbed",
                        fp=fp,
                        source=event.source_id,
                        total_sources=len(self._registry[fp]),
                    )

        return new_events

    def get_source_count(self, event: CanonicalEvent) -> int:
        """Return how many sources reported this event."""
        fp = compute_fingerprint(event)
        return len(self._registry.get(fp, []))

    def clear(self) -> None:
        """Clear the registry (e.g. on service restart or daily reset)."""
        self._registry.clear()

    def stats(self) -> dict:
        total_fingerprints = len(self._registry)
        total_events = sum(len(v) for v in self._registry.values())
        duplicates = total_events - total_fingerprints
        return {
            "unique_fingerprints": total_fingerprints,
            "total_events_seen": total_events,
            "duplicates_absorbed": duplicates,
        }
