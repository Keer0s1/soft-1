"""Клиент fast-gen API — генерация картинок (и информация о подписке/лимитах).

Картинки: POST /api/v4/<provider>/image/generate -> operation_id,
поллинг GET /api/v4/operations/{id}, на success result — картинки в base64.
"""
import asyncio
import base64
import re
from typing import Any

import httpx

from . import config


class FastGenError(Exception):
    pass


IMAGE_PROVIDERS = {
    "flow": {
        "endpoint": "/api/v4/flow/image/generate",
        "models": ["GEM_PIX_2", "IMAGEN_3_5", "NARWHAL"],
        "label": "Flow (Google)",
    },
    "flower": {
        "endpoint": "/api/v4/flower/image/generate",
        "models": [],
        "label": "Flower (Nano Banana 2)",
    },
}


def _headers() -> dict:
    return {"X-API-Key": config.FASTGEN_API_KEY}


def _check_configured():
    if not config.FASTGEN_API_KEY:
        raise FastGenError("fast-gen API не настроен: заполни FASTGEN_API_KEY в .env")


async def _get(path: str) -> Any:
    _check_configured()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{config.FASTGEN_API_URL}{path}", headers=_headers())
        r.raise_for_status()
        return r.json()


async def get_usage() -> Any:
    return await _get("/api/v5/usage")


async def get_capabilities() -> Any:
    return await _get("/api/v5/capabilities")


async def get_models() -> Any:
    return await _get("/api/v5/models")


async def submit_image(prompt: str, provider: str = "flow", model: str | None = None,
                       aspect_ratio: str = "16:9", seed: int | None = None) -> str:
    """Отправить генерацию картинки, вернуть operation_id."""
    _check_configured()
    if provider not in IMAGE_PROVIDERS:
        raise FastGenError(f"Неизвестный провайдер картинок: {provider}")
    body: dict[str, Any] = {"prompt": prompt, "aspect_ratio": aspect_ratio}
    if provider == "flow":
        body["model"] = model or "GEM_PIX_2"
        if seed is not None:
            body["seed"] = seed
    endpoint = IMAGE_PROVIDERS[provider]["endpoint"]
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{config.FASTGEN_API_URL}{endpoint}", headers=_headers(), json=body)
        if r.status_code == 403:
            raise FastGenError("fast-gen: 403 — нет активной подписки на изображения")
        if r.status_code == 429:
            raise FastGenError("fast-gen: 429 — превышен лимит одновременных генераций")
        if r.status_code >= 400:
            raise FastGenError(f"fast-gen: ошибка генерации ({r.status_code}): {r.text[:500]}")
        data = r.json()
    op_id = data.get("operation_id")
    if not op_id:
        raise FastGenError(f"fast-gen: не нашёл operation_id в ответе: {data}")
    return str(op_id)


async def get_operation(operation_id: str) -> Any:
    return await _get(f"/api/v4/operations/{operation_id}")


def _extract_image_bytes(result: Any) -> bytes:
    """Достать первую картинку из result операции (base64 / data URI, разные обёртки)."""
    items: list[Any] = []
    if isinstance(result, list):
        items = result
    elif isinstance(result, dict):
        for key in ("images", "results", "files", "data"):
            if isinstance(result.get(key), list):
                items = result[key]
                break
        else:
            items = [result]
    elif isinstance(result, str):
        items = [result]

    for item in items:
        raw: str | None = None
        if isinstance(item, str):
            raw = item
        elif isinstance(item, dict):
            for key in ("base64", "image", "data", "content", "b64_json"):
                if isinstance(item.get(key), str):
                    raw = item[key]
                    break
        if not raw:
            continue
        m = re.match(r"data:[^;]+;base64,(.*)", raw, re.DOTALL)
        if m:
            raw = m.group(1)
        try:
            return base64.b64decode(raw)
        except Exception:
            continue
    raise FastGenError(f"fast-gen: не смог достать картинку из результата операции: {str(result)[:300]}")


async def wait_for_image(operation_id: str, poll_interval: float = 4.0, timeout: float = 600) -> bytes:
    """Поллить операцию до готовности, вернуть байты картинки."""
    waited = 0.0
    while True:
        data = await get_operation(operation_id)
        status = str(data.get("status", "")).lower()
        if status in ("success", "succeeded", "completed", "done"):
            return _extract_image_bytes(data.get("result"))
        if status in ("error", "failed", "cancelled", "canceled"):
            raise FastGenError(f"fast-gen: операция {operation_id} завершилась с ошибкой: "
                               f"{str(data)[:300]}")
        if waited >= timeout:
            raise FastGenError(f"fast-gen: операция {operation_id} не завершилась за {timeout} с")
        await asyncio.sleep(poll_interval)
        waited += poll_interval


def detect_video_support(capabilities: Any, usage: Any) -> dict:
    """Понять по capabilities/usage, доступна ли генерация видео по текущей подписке.

    Структура ответов может отличаться — ищем упоминания видео-операций и
    признаки доступности. Если однозначно понять нельзя, возвращаем unknown.
    """
    info = {"available": None, "video_operations": []}
    ops = []
    if isinstance(capabilities, dict):
        for key in ("operations", "capabilities", "items", "data"):
            if isinstance(capabilities.get(key), list):
                ops = capabilities[key]
                break
    elif isinstance(capabilities, list):
        ops = capabilities

    for op in ops:
        if isinstance(op, dict):
            text = str(op).lower()
            name = op.get("operation_id") or op.get("id") or op.get("name") or ""
        else:
            text = str(op).lower()
            name = str(op)
        if "video" in text:
            entry = {"name": str(name)}
            for key in ("available", "enabled", "allowed", "has_access"):
                if isinstance(op, dict) and isinstance(op.get(key), bool):
                    entry["available"] = op[key]
            info["video_operations"].append(entry)

    flags = [e["available"] for e in info["video_operations"] if "available" in e]
    if flags:
        info["available"] = any(flags)
    elif isinstance(usage, dict) and "video" in str(usage).lower():
        # в usage есть упоминание видео — вероятно, доступно
        info["available"] = True
    return info
