"""
Inter-agent message bus — Redis Pub/Sub.

Topics:
  signalements.new          → Agent 8 (épidémie)
  signalements.catastrophe  → Agent 2 (prédiction)
  veille.new_event          → Agent 2 (prédiction)
  prediction.critical       → Agent 7 (logistique)
  anomalie_stocks.flag      → Agent 3 (antifraud)
  epidemie.alert            → Agent 6 (reporting)
  cap.alert                 → alerting service
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable
from typing import Callable

import structlog

from redis_client import get_redis

logger = structlog.get_logger(__name__)


async def publish(topic: str, payload: dict) -> None:
    """
    Publish a message to a Redis Pub/Sub topic.

    Serializes payload to JSON and publishes to the given topic.
    Errors are caught and logged — the bus never raises to callers.
    """
    try:
        redis = get_redis()
        message = json.dumps(payload, default=str)
        receivers = await redis.publish(topic, message)
        logger.info(
            "bus.published",
            topic=topic,
            receivers=receivers,
            payload_keys=list(payload.keys()),
        )
    except Exception as exc:
        logger.error(
            "bus.publish_error",
            topic=topic,
            error=str(exc),
        )


async def subscribe(
    topic: str,
    handler: Callable[[dict], Awaitable[None]],
) -> None:
    """
    Subscribe to a Redis Pub/Sub topic and invoke handler for each message.

    Runs in an infinite loop — intended to be launched as a background task.
    Reconnects automatically on transient Redis errors.
    The handler receives the deserialized dict payload.
    Handler errors are caught and logged — the subscription loop continues.
    """
    logger.info("bus.subscribed", topic=topic)

    while True:
        try:
            redis = get_redis()
            pubsub = redis.pubsub()
            await pubsub.subscribe(topic)

            async for raw_message in pubsub.listen():
                if raw_message is None:
                    continue
                msg_type = raw_message.get("type")
                if msg_type != "message":
                    # Ignore subscribe/unsubscribe confirmations
                    continue

                data = raw_message.get("data", "")
                try:
                    payload: dict = json.loads(data) if isinstance(data, (str, bytes)) else {}
                except json.JSONDecodeError as json_exc:
                    logger.warning(
                        "bus.decode_error",
                        topic=topic,
                        raw=data,
                        error=str(json_exc),
                    )
                    continue

                try:
                    await handler(payload)
                except Exception as handler_exc:
                    logger.error(
                        "bus.handler_error",
                        topic=topic,
                        error=str(handler_exc),
                    )

        except asyncio.CancelledError:
            logger.info("bus.subscription_cancelled", topic=topic)
            raise
        except Exception as exc:
            logger.error(
                "bus.subscription_error",
                topic=topic,
                error=str(exc),
            )
            # Back-off before reconnect to avoid tight error loops
            await asyncio.sleep(5)
