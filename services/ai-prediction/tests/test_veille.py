"""
Tests for the Veille agent: connectors, normalizer, deduplicator.
"""
from __future__ import annotations

import asyncio
import sys
import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add service root to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ---------------------------------------------------------------------------
# Test 1: ReliefWeb connector returns valid RawEvents (mock httpx)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_reliefweb_fetch_returns_raw_events():
    """ReliefWeb connector parses API response into RawEvents."""
    from agents.veille.connectors.reliefweb import ReliefWebConnector
    from schemas.events import RawEvent

    mock_response_data = {
        "data": [
            {
                "id": "42001",
                "fields": {
                    "name": "Flood in Nord-Kivu",
                    "type": [{"name": "Flood"}],
                    "status": "ongoing",
                    "date": {"created": "2026-06-01T08:00:00+00:00"},
                },
            },
            {
                "id": "42002",
                "fields": {
                    "name": "Epidemic outbreak Ituri",
                    "type": [{"name": "Epidemic"}],
                    "status": "alert",
                    "date": {"created": "2026-06-02T10:00:00+00:00"},
                },
            },
        ]
    }

    mock_resp = MagicMock()
    mock_resp.json.return_value = mock_response_data
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        connector = ReliefWebConnector()
        events = await connector.fetch()

    assert len(events) == 2
    for event in events:
        assert isinstance(event, RawEvent)
        assert event.source_id == "reliefweb"
        assert event.external_id in ("42001", "42002")
        assert isinstance(event.raw_data, dict)
        assert isinstance(event.fetched_at, datetime)


# ---------------------------------------------------------------------------
# Test 2: Normalizer maps "Flood" → EventType.INONDATION
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_normalizer_flood_to_inondation():
    """ReliefWeb connector normalize() maps Flood type to INONDATION."""
    from agents.veille.connectors.reliefweb import ReliefWebConnector
    from schemas.events import EventType, RawEvent

    connector = ReliefWebConnector()
    raw = RawEvent(
        source_id="reliefweb",
        external_id="99999",
        raw_data={
            "id": "99999",
            "fields": {
                "name": "Inondation Nord-Kivu",
                "type": [{"name": "Flood"}],
                "status": "ongoing",
                "date": {"created": "2026-06-01T00:00:00+00:00"},
            },
        },
        fetched_at=datetime.now(timezone.utc),
    )
    canonical = await connector.normalize(raw)

    assert canonical.event_type == EventType.INONDATION
    assert canonical.reliability_score == 0.9
    assert canonical.source_id == "reliefweb"


# ---------------------------------------------------------------------------
# Test 3: Deduplicator — two identical events → same fingerprint, source_count=2
# ---------------------------------------------------------------------------

def test_deduplicator_identical_events_same_fingerprint():
    """Two identical events share a fingerprint; source_count == 2."""
    from agents.veille.deduplicator import Deduplicator, compute_fingerprint
    from schemas.events import CanonicalEvent, EventType

    now = datetime(2026, 6, 9, 12, 0, 0, tzinfo=timezone.utc)

    event_a = CanonicalEvent(
        source_id="reliefweb",
        external_id="A1",
        event_type=EventType.INONDATION,
        title="Flood Nord-Kivu",
        p_code="CD-NK",
        fetched_at=now,
        reliability_score=0.9,
    )
    event_b = CanonicalEvent(
        source_id="open_meteo",
        external_id="B1",
        event_type=EventType.INONDATION,
        title="Flood Nord-Kivu (weather signal)",
        p_code="CD-NK",
        fetched_at=now,
        reliability_score=0.8,
    )

    fp_a = compute_fingerprint(event_a)
    fp_b = compute_fingerprint(event_b)
    assert fp_a == fp_b, "Identical type+pcode+day must produce same fingerprint"

    dedup = Deduplicator()
    new_a = dedup.process([event_a])
    new_b = dedup.process([event_b])

    assert len(new_a) == 1  # first event is new
    assert len(new_b) == 0  # second is a duplicate → not returned as new

    source_count = dedup.get_source_count(event_a)
    assert source_count == 2, f"Expected 2 sources, got {source_count}"


# ---------------------------------------------------------------------------
# Test 4: Circuit breaker opens after 5 consecutive failures
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_circuit_breaker_opens_after_5_failures():
    """Circuit breaker should open after circuit_breaker_threshold failures."""
    from agents.veille.connectors.reliefweb import ReliefWebConnector

    connector = ReliefWebConnector()
    assert connector._circuit_open is False

    # Simulate 5 failures directly
    for _ in range(5):
        connector.record_failure()

    assert connector._circuit_open is True
    assert connector._consecutive_failures == 5

    # fetch_with_retry should raise immediately (circuit open < 1h)
    with pytest.raises(RuntimeError, match="Circuit breaker open"):
        await connector.fetch_with_retry()


# ---------------------------------------------------------------------------
# Test 5: Health endpoint returns connector states
# ---------------------------------------------------------------------------

def test_veille_agent_health_returns_connector_states():
    """VeilleAgent.get_health() returns connector state dict."""
    from agents.veille.agent import VeilleAgent

    agent = VeilleAgent()
    health = agent.get_health()

    assert "agent" in health
    assert health["agent"] == "veille"
    assert "connectors" in health
    assert isinstance(health["connectors"], list)
    # Should have one entry per connector
    assert len(health["connectors"]) == 5  # reliefweb, open_meteo, fews_net, ocha_hdx, mettelsat

    connector_ids = {c["source_id"] for c in health["connectors"]}
    assert "reliefweb" in connector_ids
    assert "open_meteo" in connector_ids
    assert "fews_net" in connector_ids
    assert "ocha_hdx" in connector_ids
    assert "mettelsat" in connector_ids

    assert "event_store_size" in health
    assert "deduplicator" in health
