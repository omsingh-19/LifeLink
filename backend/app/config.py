from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
ROOT_DIR = BASE_DIR.parent  # repo root


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    database_url: str = f"sqlite:///{(BASE_DIR / 'lifelink.db').as_posix()}"
    jwt_secret: str = "dev-only-secret-change-me-in-backend-env-file"  # set JWT_SECRET in .env
    jwt_expire_minutes: int = 60 * 8
    seed_demo: bool = True

    # Routing / ETA
    osrm_enabled: bool = True
    osrm_url: str = "https://router.project-osrm.org"
    osrm_timeout_s: float = 3.0
    fallback_speed_kmh: float = 20.0
    road_factor: float = 1.3

    # Matching
    match_radii_km: list[int] = [5, 10, 25, 50]
    match_target: int = 10
    min_donation_gap_days: int = 90
    stale_stock_hours: int = 24

    # Volunteer offers
    offer_timeout_minutes: int = 10

    upload_dir: Path = BASE_DIR / "uploads"
    frontend_dir: Path = ROOT_DIR / "frontend"


settings = Settings()
