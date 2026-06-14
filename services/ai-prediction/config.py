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

    # NASA FIRMS fire hotspot API
    # Demo key works but is rate-limited; register at https://firms.modaps.eosdis.nasa.gov/api/
    firms_map_key: str = "DEMO_KEY"

    # HDX (Humanitarian Data Exchange) API key for publishing datasets
    # Leave empty to skip upload and return local export URL instead
    hdx_api_key: str = ""

    # ReliefWeb API key for submitting situation reports
    # Contact api@reliefweb.int for DRC national authority credentials
    reliefweb_api_key: str = ""

    # ACLED (Armed Conflict Location & Event Data) credentials
    # Register at https://acleddata.com/register/ for free humanitarian access
    acled_api_key: str = ""
    acled_access_email: str = ""

    # URL of the Fastify API service (used by conflit agent to bootstrap events)
    api_service_url: str = "https://api-production-65ad.up.railway.app"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", protected_namespaces=())


settings = Settings()
