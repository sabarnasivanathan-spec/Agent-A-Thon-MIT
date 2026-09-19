import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


@dataclass
class Settings:

    openrouter_api_key: str = os.getenv(
        "OPENROUTER_API_KEY",
        ""
    )

    openrouter_model: str = os.getenv(
        "OPENROUTER_MODEL",
        "openai/gpt-4o-mini"
    )

    openrouter_url: str = os.getenv(
        "OPENROUTER_URL",
        "https://openrouter.ai/api/v1/chat/completions"
    )

    app_url: str = os.getenv(
        "APP_URL",
        "http://localhost:8000"
    )

    database_url: str = os.getenv(
        "DATABASE_URL",
        "sqlite:///studysync.db"
    )


settings = Settings()