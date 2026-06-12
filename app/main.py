"""Веб-приложение: сценарий (txt) -> озвучка (Voicer) + картинки (fast-gen) -> MP4."""
import asyncio
import hashlib
import hmac
import secrets
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import config, fastgen, pipeline, voicer

app = FastAPI(title="VideoMaker")


@app.on_event("startup")
async def startup():
    pipeline.load_jobs_from_disk()

STATIC_DIR = Path(__file__).parent / "static"

# ---------------------------------------------------------------- авторизация

SESSION_COOKIE = "vm_session"


def _session_token() -> str:
    return hmac.new(config.SECRET_KEY.encode(), b"videomaker-session",
                    hashlib.sha256).hexdigest()


def _is_authed(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE, "")
    return bool(token) and secrets.compare_digest(token, _session_token())


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path in ("/login", "/favicon.ico") or _is_authed(request):
        return await call_next(request)
    if path.startswith("/api/"):
        return JSONResponse({"error": "не авторизован"}, status_code=401)
    return RedirectResponse("/login", status_code=302)


LOGIN_PAGE = """<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход — VideoMaker</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f1117;color:#e6e6e6;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}
form{background:#1a1d27;padding:32px;border-radius:12px;display:flex;flex-direction:column;
gap:12px;min-width:280px}
h1{font-size:18px;margin:0 0 8px}
input,button{padding:10px;border-radius:8px;border:1px solid #333;font-size:15px}
input{background:#0f1117;color:#e6e6e6}
button{background:#4f6ef7;color:#fff;border:none;cursor:pointer}
.err{color:#ff7b7b;font-size:13px}
</style></head><body>
<form method="post" action="/login">
<h1>🎬 VideoMaker</h1>
{ERROR}
<input type="password" name="password" placeholder="Пароль" autofocus>
<button type="submit">Войти</button>
</form></body></html>"""


@app.get("/login", response_class=HTMLResponse)
async def login_page():
    return LOGIN_PAGE.replace("{ERROR}", "")


@app.post("/login")
async def login(password: str = Form("")):
    if config.APP_PASSWORD and secrets.compare_digest(password, config.APP_PASSWORD):
        resp = RedirectResponse("/", status_code=302)
        resp.set_cookie(SESSION_COOKIE, _session_token(), httponly=True,
                        max_age=30 * 24 * 3600, samesite="lax")
        return resp
    return HTMLResponse(LOGIN_PAGE.replace(
        "{ERROR}", '<div class="err">Неверный пароль</div>'), status_code=401)


# ---------------------------------------------------------------- страницы

@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---------------------------------------------------------------- API: аккаунт

def _safe(coro):
    async def wrapper():
        try:
            return {"ok": True, "data": await coro}
        except (voicer.VoicerError, fastgen.FastGenError) as e:
            return {"ok": False, "error": str(e)}
        except httpx.HTTPStatusError as e:
            return {"ok": False,
                    "error": f"HTTP {e.response.status_code}: {e.response.text[:300]}"}
        except httpx.HTTPError as e:
            return {"ok": False, "error": f"Сетевая ошибка: {e}"}
    return wrapper()


@app.get("/api/account")
async def account():
    """Баланс Voicer, шаблоны голосов, лимиты/подписка fast-gen, доступность видео."""
    balance, templates, usage, capabilities, models = await asyncio.gather(
        _safe(voicer.get_balance()),
        _safe(voicer.get_templates()),
        _safe(fastgen.get_usage()),
        _safe(fastgen.get_capabilities()),
        _safe(fastgen.get_models()),
    )
    video = None
    if usage.get("ok") or capabilities.get("ok"):
        video = fastgen.detect_video_support(
            capabilities.get("data"), usage.get("data"))
    return {
        "voicer": {"balance": balance, "templates": templates},
        "fastgen": {"usage": usage, "capabilities": capabilities, "models": models,
                    "video_support": video},
        "image_providers": {
            name: {"label": p["label"], "models": p["models"]}
            for name, p in fastgen.IMAGE_PROVIDERS.items()
        },
        "aspect_ratios": list(config.ASPECT_SIZES.keys()),
    }


# ---------------------------------------------------------------- API: задачи

@app.post("/api/jobs")
async def create_job(
    script: UploadFile = File(...),
    prompts: UploadFile | None = File(None),
    template_id: str = Form(""),
    provider: str = Form("flow"),
    model: str = Form(""),
    aspect_ratio: str = Form("16:9"),
):
    script_text = (await script.read()).decode("utf-8", errors="replace")
    prompts_text = None
    if prompts is not None and prompts.filename:
        prompts_text = (await prompts.read()).decode("utf-8", errors="replace")
    try:
        scenes = pipeline.parse_script(script_text, prompts_text)
    except pipeline.ParseError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    if aspect_ratio not in config.ASPECT_SIZES:
        return JSONResponse({"error": f"Неподдерживаемый формат кадра: {aspect_ratio}"},
                            status_code=400)
    job = pipeline.create_job(
        scenes=scenes,
        template_id=template_id or None,
        provider=provider,
        model=model or None,
        aspect_ratio=aspect_ratio,
    )
    asyncio.create_task(pipeline.run_job(job))
    return {"job_id": job.id, "scenes": len(scenes)}


@app.get("/api/jobs")
async def list_jobs():
    jobs = sorted(pipeline.JOBS.values(), key=lambda j: j.created_at, reverse=True)
    return {"jobs": [j.to_dict() for j in jobs]}


@app.get("/api/jobs/{job_id}")
async def job_status(job_id: str):
    job = pipeline.JOBS.get(job_id)
    if not job:
        return JSONResponse({"error": "задача не найдена"}, status_code=404)
    return job.to_dict()


@app.get("/api/jobs/{job_id}/video")
async def job_video(job_id: str):
    job = pipeline.JOBS.get(job_id)
    if not job or not job.output:
        return JSONResponse({"error": "видео не готово"}, status_code=404)
    return FileResponse(job.dir / job.output, media_type="video/mp4",
                        filename=f"video_{job_id}.mp4")


def main():
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=config.PORT)


if __name__ == "__main__":
    main()
