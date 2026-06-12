"""Сборка ролика: сценарий -> озвучка + картинки -> MP4.

Тайминг: озвучка делается одним куском, длительность каждой картинки
считается пропорционально числу символов её куска текста — так смена
кадров попадает под слова.
"""
import asyncio
import io
import json
import re
import subprocess
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from . import config, fastgen, voicer


@dataclass
class Scene:
    text: str
    prompt: str


@dataclass
class Job:
    id: str
    dir: Path
    scenes: list[Scene]
    template_id: str | None
    provider: str
    model: str | None
    aspect_ratio: str
    status: str = "queued"  # queued / running / done / error
    step: str = ""
    error: str = ""
    created_at: float = field(default_factory=time.time)
    log: list[str] = field(default_factory=list)
    images_done: int = 0
    output: str | None = None  # имя файла результата в папке задачи

    def add_log(self, msg: str):
        self.log.append(f"[{time.strftime('%H:%M:%S')}] {msg}")
        self.save()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "step": self.step,
            "error": self.error,
            "created_at": self.created_at,
            "scenes": len(self.scenes),
            "images_done": self.images_done,
            "log": self.log[-50:],
            "output": self.output,
        }

    def save(self):
        (self.dir / "job.json").write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")


JOBS: dict[str, Job] = {}


# ---------------------------------------------------------------- парсинг

class ParseError(Exception):
    pass


def parse_script(script_text: str, prompts_text: str | None = None) -> list[Scene]:
    """Разобрать сценарий на сцены (текст + промт картинки).

    Вариант 1 — один файл с маркерами: после куска текста строка `IMG: промт`.
    Вариант 2 — два файла: сценарий разбит пустыми строками на абзацы,
    промты — по одному на строку (абзац N -> промт N).
    """
    if prompts_text and prompts_text.strip():
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", script_text) if p.strip()]
        prompts = [line.strip() for line in prompts_text.splitlines() if line.strip()]
        if len(paragraphs) != len(prompts):
            raise ParseError(
                f"Число абзацев сценария ({len(paragraphs)}) не совпадает с числом промтов "
                f"({len(prompts)}). Абзацы разделяются пустой строкой, промты — по одному на строку.")
        return [Scene(text=p, prompt=pr) for p, pr in zip(paragraphs, prompts)]

    scenes: list[Scene] = []
    buf: list[str] = []
    for line in script_text.splitlines():
        m = re.match(r"^\s*(?:IMG|ИЗО|КАРТИНКА)\s*:\s*(.+)$", line, re.IGNORECASE)
        if m:
            text = "\n".join(buf).strip()
            if not text:
                raise ParseError("Найден промт IMG: без текста сцены перед ним.")
            scenes.append(Scene(text=text, prompt=m.group(1).strip()))
            buf = []
        else:
            buf.append(line)
    leftover = "\n".join(buf).strip()
    if leftover:
        if scenes:
            # хвост без промта — приклеиваем к последней сцене
            scenes[-1].text += "\n" + leftover
        else:
            raise ParseError(
                "В сценарии нет промтов картинок. Либо добавь после каждого куска текста строку "
                "`IMG: промт`, либо загрузи второй файл с промтами (по одному на строку).")
    if not scenes:
        raise ParseError("Сценарий пустой.")
    return scenes


# ---------------------------------------------------------------- ffmpeg

def _run(cmd: list[str], err_prefix: str):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"{err_prefix}: {proc.stderr[-1000:]}")
    return proc


def ensure_ffmpeg():
    for tool in ("ffmpeg", "ffprobe"):
        try:
            subprocess.run([tool, "-version"], capture_output=True)
        except FileNotFoundError:
            raise RuntimeError(f"{tool} не установлен — установи ffmpeg (см. README)")


def audio_duration(path: Path) -> float:
    proc = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                "ffprobe не смог определить длительность аудио")
    return float(proc.stdout.strip())


def save_audio(raw: bytes, job_dir: Path) -> Path:
    """Сохранить результат Voicer. Если это ZIP с чанками — склеить их в один mp3."""
    out = job_dir / "voice.mp3"
    if raw[:2] != b"PK":
        out.write_bytes(raw)
        return out

    chunks_dir = job_dir / "audio_chunks"
    chunks_dir.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        names = sorted(n for n in zf.namelist() if n.lower().endswith(".mp3"))
        if not names:
            raise RuntimeError("ZIP от Voicer не содержит mp3-файлов")
        paths = []
        for i, name in enumerate(names):
            p = chunks_dir / f"chunk_{i:04d}.mp3"
            p.write_bytes(zf.read(name))
            paths.append(p)
    if len(paths) == 1:
        out.write_bytes(paths[0].read_bytes())
        return out
    concat_list = job_dir / "audio_concat.txt"
    concat_list.write_text("".join(f"file '{p.resolve()}'\n" for p in paths), encoding="utf-8")
    _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
          "-c:a", "libmp3lame", "-q:a", "2", str(out)],
         "ffmpeg не смог склеить аудио-чанки")
    return out


def render_video(job: Job, audio_path: Path, image_paths: list[Path]) -> Path:
    total = audio_duration(audio_path)
    char_counts = [max(len(s.text), 1) for s in job.scenes]
    total_chars = sum(char_counts)
    durations = [total * c / total_chars for c in char_counts]

    timings_path = job.dir / "timings.json"
    timings_path.write_text(json.dumps([
        {"scene": i + 1, "start": round(sum(durations[:i]), 2), "duration": round(d, 2),
         "prompt": s.prompt}
        for i, (d, s) in enumerate(zip(durations, job.scenes))
    ], ensure_ascii=False, indent=2), encoding="utf-8")

    concat = job.dir / "video_concat.txt"
    lines = []
    for path, dur in zip(image_paths, durations):
        lines.append(f"file '{path.resolve()}'\n")
        lines.append(f"duration {dur:.3f}\n")
    lines.append(f"file '{image_paths[-1].resolve()}'\n")  # требование concat demuxer
    concat.write_text("".join(lines), encoding="utf-8")

    w, h = config.ASPECT_SIZES.get(job.aspect_ratio, (1920, 1080))
    out = job.dir / "video.mp4"
    _run(["ffmpeg", "-y",
          "-f", "concat", "-safe", "0", "-i", str(concat),
          "-i", str(audio_path),
          "-vf", (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                  f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p"),
          "-r", "30", "-c:v", "libx264", "-preset", "medium",
          "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)],
         "ffmpeg не смог собрать видео")
    return out


# ---------------------------------------------------------------- оркестрация

async def _generate_images(job: Job) -> list[Path]:
    sem = asyncio.Semaphore(config.IMAGE_CONCURRENCY)
    images_dir = job.dir / "images"
    images_dir.mkdir(exist_ok=True)
    paths: list[Path | None] = [None] * len(job.scenes)

    async def one(i: int, scene: Scene):
        async with sem:
            op_id = await fastgen.submit_image(
                scene.prompt, provider=job.provider, model=job.model,
                aspect_ratio=job.aspect_ratio)
            data = await fastgen.wait_for_image(op_id)
        p = images_dir / f"scene_{i:03d}.png"
        p.write_bytes(data)
        paths[i] = p
        job.images_done += 1
        job.step = f"Генерация картинок ({job.images_done}/{len(job.scenes)})"
        job.add_log(f"Картинка {i + 1}/{len(job.scenes)} готова")

    await asyncio.gather(*(one(i, s) for i, s in enumerate(job.scenes)))
    return [p for p in paths if p is not None]


async def run_job(job: Job):
    job.status = "running"
    try:
        ensure_ffmpeg()

        full_text = "\n\n".join(s.text for s in job.scenes)
        job.step = "Озвучка: отправка задачи в Voicer"
        job.add_log(f"Сцен: {len(job.scenes)}, символов текста: {len(full_text)}")
        task_id = await voicer.create_task(full_text, job.template_id)
        job.add_log(f"Voicer-задача создана: {task_id}")

        job.step = "Озвучка: ожидание синтеза"
        await voicer.wait_until_ready(task_id, on_status=lambda s: None)
        raw = await voicer.download_result(task_id)
        audio_path = save_audio(raw, job.dir)
        job.add_log(f"Озвучка готова ({audio_path.stat().st_size // 1024} КБ)")

        job.step = f"Генерация картинок (0/{len(job.scenes)})"
        image_paths = await _generate_images(job)

        job.step = "Сборка видео (ffmpeg)"
        out = render_video(job, audio_path, image_paths)
        job.output = out.name
        job.step = "Готово"
        job.status = "done"
        job.add_log(f"Видео собрано: {out.name}")
    except Exception as e:
        job.status = "error"
        job.error = str(e)
        job.add_log(f"ОШИБКА: {e}")
    finally:
        job.save()


def load_jobs_from_disk():
    """Восстановить список задач после перезапуска сервера (только для отображения)."""
    for job_dir in sorted(config.JOBS_DIR.iterdir()):
        meta_path = job_dir / "job.json"
        scenes_path = job_dir / "scenes.json"
        if not meta_path.exists() or not scenes_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            scenes_raw = json.loads(scenes_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        job = Job(
            id=meta["id"], dir=job_dir,
            scenes=[Scene(**s) for s in scenes_raw],
            template_id=None, provider="", model=None, aspect_ratio="16:9",
            status=meta.get("status", "error"),
            step=meta.get("step", ""),
            error=meta.get("error", ""),
            created_at=meta.get("created_at", 0),
            log=meta.get("log", []),
            images_done=meta.get("images_done", 0),
            output=meta.get("output"),
        )
        if job.status in ("queued", "running"):
            job.status = "error"
            job.error = "Прервано перезапуском сервера"
        JOBS[job.id] = job


def create_job(scenes: list[Scene], template_id: str | None, provider: str,
               model: str | None, aspect_ratio: str) -> Job:
    job_id = uuid.uuid4().hex[:12]
    job_dir = config.JOBS_DIR / job_id
    job_dir.mkdir(parents=True)
    job = Job(id=job_id, dir=job_dir, scenes=scenes, template_id=template_id,
              provider=provider, model=model, aspect_ratio=aspect_ratio)
    (job_dir / "scenes.json").write_text(json.dumps(
        [{"text": s.text, "prompt": s.prompt} for s in scenes],
        ensure_ascii=False, indent=2), encoding="utf-8")
    job.save()
    JOBS[job_id] = job
    return job
