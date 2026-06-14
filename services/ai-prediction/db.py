"""
Async SQLAlchemy database pool for SINAUR-RDC AI Prediction Service.
"""
from __future__ import annotations

import ssl as _ssl
from collections.abc import AsyncGenerator

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import settings

logger = structlog.get_logger(__name__)

# Replace postgresql:// with postgresql+asyncpg://
_db_url = settings.database_url
if _db_url.startswith("postgresql://"):
    _db_url = "postgresql+asyncpg://" + _db_url[len("postgresql://"):]
elif _db_url.startswith("postgres://"):
    _db_url = "postgresql+asyncpg://" + _db_url[len("postgres://"):]

# asyncpg rejects sslmode as a URL param — strip it and pass ssl via connect_args
_ssl_ctx: _ssl.SSLContext | None = None
if "sslmode=require" in _db_url:
    _db_url = _db_url.replace("?sslmode=require", "").replace("&sslmode=require", "")
    _ssl_ctx = _ssl.create_default_context()

engine = create_async_engine(
    _db_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    echo=False,
    connect_args={"ssl": _ssl_ctx} if _ssl_ctx else {},
)

_AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async DB session."""
    async with _AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
