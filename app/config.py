from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    telegram_bot_token: str = Field(default="", alias="TELEGRAM_BOT_TOKEN")
    app_base_url: str = Field(default="http://localhost:8000", alias="APP_BASE_URL")
    database_path: str = Field(default="./telexpense.sqlite3", alias="DATABASE_PATH")
    budget_warning_ratio: float = Field(default=0.8, alias="BUDGET_WARNING_RATIO")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()

