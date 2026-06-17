-- =============================================================
-- Faceless Video Generator — SQL-скрипт инициализации БД
--
-- Создаёт все таблицы, индексы и внешние ключи в пустой БД PostgreSQL.
-- Используй если не хочешь работать с Prisma CLI:
--
--   psql -U postgres -c "CREATE DATABASE soft;"
--   psql -U postgres -d soft -f init.sql
--
-- Альтернатива (рекомендуется): из папки backend/ запусти `npm run db:push`
-- =============================================================

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Без названия',
    "folderName" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT 'flow',
    "model" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "voiceTemplateId" TEXT,
    "zoomEnabled" BOOLEAN NOT NULL DEFAULT true,
    "zoomIntensity" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "zoomSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "zoomEasing" TEXT NOT NULL DEFAULT 'linear',
    "cameraShake" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "zoomPresets" JSONB NOT NULL DEFAULT '["in","out","left","right"]',
    "transitionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "transitionDuration" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "transitionPresets" JSONB NOT NULL DEFAULT '["fade","dissolve","smoothleft","circleopen","fadeblack"]',
    "renderQuality" TEXT NOT NULL DEFAULT 'balance',
    "grainEnabled" BOOLEAN NOT NULL DEFAULT false,
    "grainIntensity" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "vignetteEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vignetteIntensity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "lutFile" TEXT,
    "ccBrightness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ccContrast" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ccSaturation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ccTemperature" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bgMusicPath" TEXT,
    "bgMusicVolume" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "bgMusicDucking" BOOLEAN NOT NULL DEFAULT true,
    "subtitlesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "subtitlesStyle" TEXT NOT NULL DEFAULT 'modern',
    "subtitlesFontSize" INTEGER NOT NULL DEFAULT 48,
    "subtitlesPosition" TEXT NOT NULL DEFAULT 'bottom',
    "subtitlesX" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "subtitlesY" DOUBLE PRECISION NOT NULL DEFAULT 85,
    "subtitlesColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "subtitlesOutline" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "subtitlesOutlineColor" TEXT NOT NULL DEFAULT '#000000',
    "subtitlesShadow" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "subtitlesAnimation" TEXT NOT NULL DEFAULT 'fade',
    "subtitlesMode" TEXT NOT NULL DEFAULT 'karaoke',
    "subtitlesBgEnabled" BOOLEAN NOT NULL DEFAULT false,
    "subtitlesBgColor" TEXT NOT NULL DEFAULT '#000000',
    "subtitlesBgOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "subtitlesSpacing" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "voicePreviewPath" TEXT,
    "voicePreviewStatus" TEXT NOT NULL DEFAULT 'none',
    "voicePreviewError" TEXT NOT NULL DEFAULT '',
    "voiceTextHash" TEXT,
    "customVoicePath" TEXT,
    "videoPreviewPath" TEXT,
    "videoPreviewStatus" TEXT NOT NULL DEFAULT 'none',
    "videoPreviewError" TEXT NOT NULL DEFAULT '',
    "videoPreviewHash" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "voiceText" TEXT NOT NULL,
    "imagePrompt" TEXT NOT NULL,
    "effectOverrides" JSONB,
    "durationOverride" DOUBLE PRECISION,
    "imagePath" TEXT,
    "imageStatus" TEXT NOT NULL DEFAULT 'none',
    "imageError" TEXT NOT NULL DEFAULT '',
    "imageOpId" TEXT,
    "imageSeed" INTEGER,
    "imageSource" TEXT NOT NULL DEFAULT 'ai',
    "imageUpdatedAt" TIMESTAMP(3),
    "activeImageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneImage" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "seed" INTEGER,
    "prompt" TEXT NOT NULL DEFAULT '',
    "opId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SceneImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "step" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "log" JSONB NOT NULL DEFAULT '[]',
    "scenesCount" INTEGER NOT NULL DEFAULT 0,
    "imagesDone" INTEGER NOT NULL DEFAULT 0,
    "voicerTaskId" TEXT,
    "voiceCostChars" INTEGER,
    "audioPath" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'flow',
    "model" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "outputPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "voiceText" TEXT NOT NULL,
    "imagePrompt" TEXT NOT NULL,
    "imagePath" TEXT,
    "operationId" TEXT,
    "durationSec" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT NOT NULL DEFAULT '',
    "clipPath" TEXT,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SceneResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SfxPlacement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "soundFile" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "timeSec" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "category" TEXT NOT NULL DEFAULT 'library',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SfxPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CtaOverlay" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '',
    "imagePath" TEXT,
    "timeSec" DOUBLE PRECISION NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 85,
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "animation" TEXT NOT NULL DEFAULT 'slideIn',
    "style" TEXT NOT NULL DEFAULT 'pill',
    "color" TEXT NOT NULL DEFAULT '#FF0000',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CtaOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Overlay" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "fontFamily" TEXT NOT NULL DEFAULT 'Arial',
    "fontSize" INTEGER NOT NULL DEFAULT 48,
    "fontColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "fontWeight" TEXT NOT NULL DEFAULT 'bold',
    "outlineWidth" INTEGER NOT NULL DEFAULT 3,
    "outlineColor" TEXT NOT NULL DEFAULT '#000000',
    "shadowSize" INTEGER NOT NULL DEFAULT 2,
    "bgEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bgColor" TEXT NOT NULL DEFAULT '#000000',
    "bgOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "bgRadius" INTEGER NOT NULL DEFAULT 8,
    "textPreset" TEXT NOT NULL DEFAULT 'custom',
    "filePath" TEXT,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timeSec" DOUBLE PRECISION NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "animIn" TEXT NOT NULL DEFAULT 'fadeIn',
    "animOut" TEXT NOT NULL DEFAULT 'fadeOut',
    "animIdle" TEXT NOT NULL DEFAULT 'none',
    "animInDur" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "animOutDur" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "soundFile" TEXT,
    "soundVolume" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Overlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scene_projectId_order_idx" ON "Scene"("projectId", "order");

-- CreateIndex
CREATE INDEX "SceneImage_sceneId_createdAt_idx" ON "SceneImage"("sceneId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_projectId_createdAt_idx" ON "Job"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "SceneResult_jobId_order_idx" ON "SceneResult"("jobId", "order");

-- CreateIndex
CREATE INDEX "SfxPlacement_projectId_idx" ON "SfxPlacement"("projectId");

-- CreateIndex
CREATE INDEX "CtaOverlay_projectId_idx" ON "CtaOverlay"("projectId");

-- CreateIndex
CREATE INDEX "Overlay_projectId_idx" ON "Overlay"("projectId");

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneImage" ADD CONSTRAINT "SceneImage_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneResult" ADD CONSTRAINT "SceneResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SfxPlacement" ADD CONSTRAINT "SfxPlacement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CtaOverlay" ADD CONSTRAINT "CtaOverlay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Overlay" ADD CONSTRAINT "Overlay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

