"""Клиент Voicer API — синтез речи (TTS).

Workflow: POST /tasks -> GET /tasks/{id}/status -> GET /tasks/{id}/result.
Статусы: waiting -> processing -> ending -> ending_processed; error / error_handled.
"""
import asyncio
from typing import Any

import httpx

from . import config


class VoicerError(Exception):
    pass


def _headers() -> dict:
    return {"X-API-Key": config.VOICER_API_KEY}


def _check_configured():
    if not config.VOICER_API_URL or not config.VOICER_API_KEY:
        raise VoicerError("Voicer API не настроен: заполни VOICER_API_URL и VOICER_API_KEY в .env")


async def get_balance() -> Any:
    _check_configured()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{config.VOICER_API_URL}/balance", headers=_headers())
        r.raise_for_status()
        return r.json()


async def get_templates() -> Any:
    """Шаблоны голоса/настроек, созданные через Telegram-бота."""
    _check_configured()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{config.VOICER_API_URL}/templates", headers=_headers())
        r.raise_for_status()
        return r.json()


async def create_task(text: str, template_id: str | None = None) -> str:
    """Создать задачу синтеза, вернуть её id."""
    _check_configured()
    body: dict[str, Any] = {"text": text}
    if template_id:
        body["template_id"] = template_id
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{config.VOICER_API_URL}/tasks", headers=_headers(), json=body)
        if r.status_code >= 400:
            raise VoicerError(f"Voicer: ошибка создания задачи ({r.status_code}): {r.text[:500]}")
        data = r.json()
    task_id = data.get("task_id") or data.get("id") or data.get("uuid")
    if not task_id:
        raise VoicerError(f"Voicer: не нашёл id задачи в ответе: {data}")
    return str(task_id)


async def get_status(task_id: str) -> str:
    _check_configured()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{config.VOICER_API_URL}/tasks/{task_id}/status", headers=_headers())
        r.raise_for_status()
        data = r.json()
    status = data.get("status") or data.get("state")
    if not status:
        raise VoicerError(f"Voicer: не нашёл статус в ответе: {data}")
    return str(status)


async def wait_until_ready(task_id: str, poll_interval: float = 5.0, timeout: float = 1800,
                           on_status=None) -> str:
    """Поллить статус, пока озвучка не будет готова. Возвращает финальный статус."""
    waited = 0.0
    while True:
        status = await get_status(task_id)
        if on_status:
            on_status(status)
        if status in ("ending", "ending_processed"):
            return status
        if status in ("error", "error_handled"):
            raise VoicerError(f"Voicer: задача {task_id} завершилась с ошибкой (статус {status})")
        if waited >= timeout:
            raise VoicerError(f"Voicer: задача {task_id} не завершилась за {timeout} с")
        await asyncio.sleep(poll_interval)
        waited += poll_interval


async def download_result(task_id: str) -> bytes:
    """Скачать результат (MP3 или ZIP с чанками)."""
    _check_configured()
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.get(f"{config.VOICER_API_URL}/tasks/{task_id}/result", headers=_headers())
        r.raise_for_status()
        return r.content
