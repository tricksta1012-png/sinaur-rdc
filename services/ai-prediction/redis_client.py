"""
Async Redis client for SINAUR-RDC AI Prediction Service.
"""
from __future__ import annotations

import structlog
from redis.asyncio import Redis, from_url

from config import settings

logger = structlog.get_logger(__name__)

# Well-known queue names
QUEUE_ALERTS_PENDING = "sinaur:alerts:pending"
QUEUE_FRAUD_REVIEW = "sinaur:fraud:review"

_redis_instance: Redis | None = None


def get_redis() -> Redis:
    """Return a module-level shared async Redis client (lazy init)."""
    global _redis_instance
    if _redis_instance is None:
        _redis_instance = from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        logger.info("redis_client.initialized", url=settings.redis_url)
    return _redis_instance


async def close_redis() -> None:
    """Close the Redis connection gracefully."""
    global _redis_instance
    if _redis_instance is not None:
        await _redis_instance.aclose()
        _redis_instance = None
        logger.info("redis_client.closed")
