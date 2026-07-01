import { z } from 'zod';

const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
const PROVIDERS = ['flow', 'flower'] as const;
const RENDER_QUALITIES = ['fast', 'balance', 'quality'] as const;

export const createProjectSchema = z.object({
  title: z.string().max(200).optional(),
});

export const updateProjectSchema = z.object({
  title: z.string().max(200).optional(),
  provider: z.enum(PROVIDERS).optional(),
  model: z.string().max(50).nullable().optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  voiceTemplateId: z.string().max(100).nullable().optional(),
  zoomEnabled: z.boolean().optional(),
  zoomIntensity: z.number().min(0).max(0.5).optional(),
  zoomPresets: z.array(z.string().max(20)).max(20).optional(),
  zoomSpeed: z.number().min(0.5).max(2.0).optional(),
  zoomEasing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut'] as const).optional(),
  cameraShake: z.number().min(0).max(20).optional(),
  transitionEnabled: z.boolean().optional(),
  transitionDuration: z.number().min(0.1).max(2).optional(),
  transitionPresets: z.array(z.string().max(30)).max(40).optional(),
  renderQuality: z.enum(RENDER_QUALITIES).optional(),
  minSceneDurationSec: z.number().min(0.3).max(10).optional(),
  // Grading
  grainEnabled: z.boolean().optional(),
  grainIntensity: z.number().min(1).max(25).optional(),
  vignetteEnabled: z.boolean().optional(),
  vignetteIntensity: z.number().min(0.1).max(1.0).optional(),
  lutFile: z.string().max(100).nullable().optional(),
  // Color correction
  ccBrightness: z.number().min(-100).max(100).optional(),
  ccContrast: z.number().min(-100).max(100).optional(),
  ccSaturation: z.number().min(-100).max(100).optional(),
  ccTemperature: z.number().min(-100).max(100).optional(),
  // Music
  bgMusicPath: z.string().max(500).nullable().optional(),
  bgMusicVolume: z.number().min(0).max(1).optional(),
  bgMusicDucking: z.boolean().optional(),
  // Subtitles
  subtitlesEnabled: z.boolean().optional(),
  subtitlesStyle: z.enum(['modern', 'classic', 'bold', 'minimal'] as const).optional(),
  subtitlesFontSize: z.number().int().min(16).max(120).optional(),
  subtitlesPosition: z.enum(['bottom', 'center', 'top'] as const).optional(),
  subtitlesX: z.number().min(0).max(100).optional(),
  subtitlesY: z.number().min(0).max(100).optional(),
  subtitlesColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  subtitlesOutline: z.number().min(0).max(8).optional(),
  subtitlesOutlineColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  subtitlesShadow: z.number().min(0).max(5).optional(),
  subtitlesAnimation: z.enum(['fade', 'slideUp', 'scale', 'typewriter'] as const).optional(),
  subtitlesMode: z.enum(['karaoke', 'phrase'] as const).optional(),
  subtitlesBgEnabled: z.boolean().optional(),
  subtitlesBgColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  subtitlesBgOpacity: z.number().min(0).max(1).optional(),
  subtitlesSpacing: z.number().min(0).max(50).optional(),
});

export const replaceScenesSchema = z.object({
  scenes: z.array(z.object({
    voiceText: z.string().max(10000).default(''),
    imagePrompt: z.string().max(2000).default(''),
  })).min(1).max(500),
});

/** Импорт сцен с прикреплёнными картинками (data-URI). Промт необязателен,
 *  если фото уже есть — оно станет активным вариантом сцены. */
export const replaceScenesWithImagesSchema = z.object({
  scenes: z.array(z.object({
    voiceText: z.string().max(10000).default(''),
    imagePrompt: z.string().max(2000).default(''),
    imageDataUri: z.string().max(20_000_000).optional(),
  })).min(1).max(500),
});

export const createSceneSchema = z.object({
  voiceText: z.string().max(10000).optional().default(''),
  imagePrompt: z.string().max(2000).optional().default(''),
});

export const effectOverridesSchema = z.object({
  zoom: z.string().max(20).optional(),
  zoomIntensity: z.number().min(0).max(0.5).optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
  easing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut'] as const).optional(),
  focusX: z.number().min(0).max(100).optional(),
  focusY: z.number().min(0).max(100).optional(),
  cameraShake: z.number().min(0).max(20).optional(),
  transition: z.string().max(30).optional(),
  transitionDuration: z.number().min(0.1).max(2).optional(),
  subtitlesX: z.number().min(0).max(100).optional(),
  subtitlesY: z.number().min(0).max(100).optional(),
  subtitlesStyle: z.enum(['modern', 'classic', 'bold', 'minimal'] as const).optional(),
  disableZoom: z.boolean().optional(),
  disableTransition: z.boolean().optional(),
  disableSubtitles: z.boolean().optional(),
}).strict().nullable();

export const updateSceneSchema = z.object({
  voiceText: z.string().max(10000).optional(),
  imagePrompt: z.string().max(2000).optional(),
  effectOverrides: effectOverridesSchema.optional(),
  durationOverride: z.number().min(0.5).max(300).nullable().optional(),
});

export const batchUpdateScenesSchema = z.object({
  sceneIds: z.array(z.string()).min(1).max(500),
  patch: z.object({
    effectOverrides: effectOverridesSchema.optional(),
    durationOverride: z.number().min(0.5).max(300).nullable().optional(),
  }),
});

export const reorderScenesSchema = z.object({
  orderedIds: z.array(z.string()).min(1).max(500),
});

export const genImageSchema = z.object({
  newSeed: z.boolean().optional().default(false),
});

export const uploadImageSchema = z.object({
  dataUri: z.string().max(20_000_000),
});

export const setActiveImageSchema = z.object({
  imageId: z.string().min(1),
});

export const parseFilesSchema = z.object({
  speechText: z.string().max(1_000_000),
  promptsText: z.string().max(1_000_000),
  bigStory: z.boolean().optional(),
});

// Аудио: до ~150 МБ как base64 data-URI. Длинные озвучки бывают 50-100 МБ mp3.
export const uploadAudioSchema = z.object({
  dataUri: z.string().regex(/^data:audio\//).max(200_000_000),
});

// SFX / CTA / overlays могут быть аудио или изображения. Имя — короткое и
// безопасное, без слешей и без «..».
const SAFE_NAME = /^[^\\/\x00\r\n]+$/;
export const uploadSfxSchema = z.object({
  dataUri: z.string().regex(/^data:audio\//).max(50_000_000),
  name: z.string().min(1).max(200).regex(SAFE_NAME).refine((n) => n !== '..' && n !== '.', 'имя файла недопустимо'),
});

export const uploadCtaImageSchema = z.object({
  dataUri: z.string().regex(/^data:image\//).max(20_000_000),
  name: z.string().min(1).max(200).regex(SAFE_NAME).refine((n) => n !== '..' && n !== '.', 'имя файла недопустимо'),
});

export const uploadOverlaySchema = z.object({
  dataUri: z.string().regex(/^data:(image|audio|video)\//).max(200_000_000),
  name: z.string().min(1).max(200).regex(SAFE_NAME).refine((n) => n !== '..' && n !== '.', 'имя файла недопустимо'),
});
