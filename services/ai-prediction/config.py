"""
Configuration SINAUR-RDC AI Prediction Service.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://sinaur:sinaur_secret@localhost:5432/sinaur_rdc"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "dev-secret"
    internal_api_key: str = "dev-internal-key"
    reliefweb_app_name: str = "sinaur-rdc"
    open_meteo_base_url: str = "https://api.open-meteo.com/v1"
    cap_sender_id: str = "sinaur-rdc.cd"
    alert_validation_required: bool = True
    model_artifacts_path: str = "./model_artifacts"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
