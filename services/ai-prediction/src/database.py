from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from .config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)
SessionLocal = sessionmaker(bind=engine)


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def fetch_all(query: str, params: dict = {}) -> list[dict]:
    with engine.connect() as conn:
        result = conn.execute(text(query), params)
        cols = list(result.keys())
        return [dict(zip(cols, row)) for row in result.fetchall()]
