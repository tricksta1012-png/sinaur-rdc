from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    database_url: str = "postgresql://sinaur:sinaur_secret@localhost:5432/sinaur_rdc"
    redis_url: str = "redis://localhost:6379"
    model_store_path: str = str(Path(__file__).parent.parent / "model_store")
    log_level: str = "INFO"
    api_key: str = ""
    internal_api_key: str = "dev-internal-key"

    class Config:
        env_file = "../../.env"
        env_file_encoding = "utf-8"


settings = Settings()
