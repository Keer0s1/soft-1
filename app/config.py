import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

APP_PASSWORD = os.getenv("APP_PASSWORD", "")
SECRET_KEY = os.getenv("SECRET_KEY", "")

VOICER_API_URL = os.getenv("VOICER_API_URL", "").rstrip("/")
VOICER_API_KEY = os.getenv("VOICER_API_KEY", "")

FASTGEN_API_URL = os.getenv("FASTGEN_API_URL", "https://googler.fast-gen.ai").rstrip("/")
FASTGEN_API_KEY = os.getenv("FASTGEN_API_KEY", "")

DATA_DIR = Path(os.getenv("DATA_DIR", "./data")).resolve()
JOBS_DIR = DATA_DIR / "jobs"
JOBS_DIR.mkdir(parents=True, exist_ok=True)

PORT = int(os.getenv("PORT", "8000"))

# Сколько картинок генерируем одновременно (лимит fast-gen — 5 на пользователя)
IMAGE_CONCURRENCY = 5

ASPECT_SIZES = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "4:3": (1440, 1080),
    "3:4": (1080, 1440),
}
