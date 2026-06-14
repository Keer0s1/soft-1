# 🎬 Генератор faceless-роликов

Сайт для сборки роликов под YouTube: пишешь сценарий по сценам (текст + промт картинки),
сайт озвучивает текст через **Voicer API**, генерирует картинки через **fast-gen API**
и собирает готовый **MP4**, где смена кадров попадает под слова.

> Сейчас режим **только фото** (картинка + озвучка). Видео-сцены (Veo) добавим позже —
> архитектура к этому готова.

## Стек

| Часть | Технологии |
|---|---|
| `backend/` | Node.js + TypeScript, Express, **Prisma + PostgreSQL**, ffmpeg (через `ffmpeg-static`) |
| `frontend/` | React (JSX) + Vite, React Router |

ffmpeg ставить в систему **не нужно** — бинарник идёт npm-пакетом `ffmpeg-static`.

## Как это работает

1. Создаёшь проект и заполняешь сцены: в каждой — **текст озвучки** и **промт картинки**.
2. Весь текст озвучивается **одним куском** через Voicer (так обходится минималка 500 символов).
3. По каждому промту генерируется картинка через fast-gen (до 5 одновременно).
4. Длительность каждой картинки считается **пропорционально длине её текста** —
   когда в озвучке речь про сцену №2, на экране картинка №2.
5. ffmpeg склеивает картинки и озвучку в MP4 — скачиваешь готовый ролик.

Вся история запусков (какой промт/текст/настройки использовались, где лежит файл)
хранится в базе — всегда можно вернуться и посмотреть.

## Установка и запуск

Нужны **Node.js 20+** и **PostgreSQL** (у тебя стоит pgAdmin 4 — это он).

### 1. База данных

В pgAdmin создай пустую базу, например `soft`.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env          # впиши DATABASE_URL и оба API-ключа
npm run prisma:generate       # сгенерировать клиент Prisma
npm run db:push               # создать таблицы в базе
npm run dev                   # старт на http://localhost:8000
```

### 3. Frontend (в отдельном терминале)

```bash
cd frontend
npm install
npm run dev                   # старт на http://localhost:5173
```

Открой **http://localhost:5173** — это сайт. Фронт проксирует запросы на бэкенд `:8000`.

### Продакшн-сборка (один сервер)

```bash
cd frontend && npm run build      # соберёт frontend/dist
cd ../backend && npm run build && npm start
```

Бэкенд сам отдаст собранный фронт — открывай `http://localhost:8000`.

## Настройка `.env` (в папке `backend/`)

| Переменная | Что это |
|---|---|
| `DATABASE_URL` | строка подключения к PostgreSQL (см. пример в `.env.example`) |
| `VOICER_API_URL` | `https://voiceapiru.csv666.ru` |
| `VOICER_API_KEY` | ключ Voicer (заголовок `X-API-Key`) |
| `FASTGEN_API_URL` | `https://googler.fast-gen.ai` |
| `FASTGEN_API_KEY` | ключ fast-gen (заголовок `X-API-Key`) |
| `IMAGE_CONCURRENCY` | сколько картинок генерить параллельно (лимит fast-gen — 5) |
| `VIDEO_CODEC` | `libx264` (CPU) или `h264_nvenc` (NVIDIA, быстрее) |

## Модели картинок

- **Flow (Google)**: `GEM_PIX_2` (Nano Pro), `IMAGEN_3_5` (Imagen 4), `NARWHAL` (Nano Banana 2)
- **Flower**: Nano Banana 2 (модель одна)

Форматы кадра: 16:9 (обычный YouTube), 9:16 (Shorts), 1:1, 4:3, 3:4.

## Импорт сценария из текста

Кроме ручного редактора сцен, есть кнопка «Импорт из текста»:

**Вариант 1 — один текст** с маркерами `IMG:` (или `ИЗО:`, `КАРТИНКА:`) после каждого куска:

```
Текст первой сцены…
IMG: cinematic winter city, warm light

Текст второй сцены…
IMG: close-up of a face, dramatic light
```

**Вариант 2 — два поля:** слева сценарий (абзацы через пустую строку),
справа промты по одному на строку: абзац №1 → промт №1.

Пример — в `examples/сценарий_пример.txt`.

## Структура

```
backend/
  prisma/schema.prisma     # модели: Project, Scene, Job, SceneResult
  src/
    lib/voicer.ts          # клиент Voicer (TTS)
    lib/fastgen.ts         # клиент fast-gen (картинки)
    lib/ffmpeg.ts          # длительность, склейка чанков, рендер слайдшоу
    lib/parse.ts           # разбор сценария в сцены
    services/pipeline.ts   # оркестрация: озвучка + картинки + сборка
    routes/                # projects, jobs, meta (API)
    index.ts               # Express-сервер
frontend/
  src/
    pages/ProjectsPage.jsx # список роликов
    pages/EditorPage.jsx   # редактор сцен + запуск + история
    components/            # JobProgress, ImportDialog
```

## Планы на потом

- **Видео-сцены** вместо статичных картинок (fast-gen `flower/video/from-text`, Veo 3.1) —
  когда подключишь подписку с видео.
- Эффект Кена Бёрнса (плавный зум картинки) и переходы между кадрами.
- Авто-субтитры (Voicer умеет отдавать `subtitles`).
