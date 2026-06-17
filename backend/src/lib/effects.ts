// Пресеты эффектов: зум/панорама (Ken Burns) и переходы (xfade).
// Здесь же — построение ffmpeg-выражений и случайный выбор из подмножества,
// чтобы эффекты не шли подряд одинаковыми.

export interface ZoomPreset {
  id: string;
  label: string;
}

// Набор движений камеры. Выражения строятся в buildZoomFilter().
export const ZOOM_PRESETS: ZoomPreset[] = [
  { id: 'in', label: 'Наезд' },
  { id: 'out', label: 'Отъезд' },
  { id: 'left', label: 'Панорама влево' },
  { id: 'right', label: 'Панорама вправо' },
  { id: 'up', label: 'Панорама вверх' },
  { id: 'down', label: 'Панорама вниз' },
  { id: 'inUp', label: 'Наезд + вверх' },
  { id: 'inDown', label: 'Наезд + вниз' },
  { id: 'slowDrift', label: 'Медленный дрифт' },
  { id: 'breathe', label: 'Дыхание' },
  { id: 'cinematic', label: 'Кинематограф' },
];

export interface TransitionPreset {
  id: string; // имя xfade-перехода
  label: string;
}

export const TRANSITION_PRESETS: TransitionPreset[] = [
  { id: 'fade', label: 'Плавное затухание' },
  { id: 'fadeblack', label: 'Через чёрный' },
  { id: 'fadewhite', label: 'Через белый' },
  { id: 'dissolve', label: 'Растворение' },
  { id: 'wipeleft', label: 'Шторка влево' },
  { id: 'wiperight', label: 'Шторка вправо' },
  { id: 'wipeup', label: 'Шторка вверх' },
  { id: 'wipedown', label: 'Шторка вниз' },
  { id: 'slideleft', label: 'Сдвиг влево' },
  { id: 'slideright', label: 'Сдвиг вправо' },
  { id: 'slideup', label: 'Сдвиг вверх' },
  { id: 'slidedown', label: 'Сдвиг вниз' },
  { id: 'smoothleft', label: 'Плавный влево' },
  { id: 'smoothright', label: 'Плавный вправо' },
  { id: 'smoothup', label: 'Плавный вверх' },
  { id: 'smoothdown', label: 'Плавный вниз' },
  { id: 'circleopen', label: 'Круг (открытие)' },
  { id: 'circleclose', label: 'Круг (закрытие)' },
  { id: 'radial', label: 'Радиально' },
  { id: 'pixelize', label: 'Пиксели' },
  { id: 'diagbl', label: 'Диагональ ↙' },
  { id: 'diagbr', label: 'Диагональ ↘' },
  { id: 'diagtl', label: 'Диагональ ↖' },
  { id: 'diagtr', label: 'Диагональ ↗' },
  { id: 'hlslice', label: 'Горизонтальные полосы' },
  { id: 'vuslice', label: 'Вертикальные полосы вверх' },
  { id: 'vdslice', label: 'Вертикальные полосы вниз' },
  { id: 'horzopen', label: 'Горизонтальное раскрытие' },
  { id: 'vertopen', label: 'Вертикальное раскрытие' },
  { id: 'horzclose', label: 'Горизонтальное закрытие' },
  { id: 'vertclose', label: 'Вертикальное закрытие' },
];

const ZOOM_IDS = new Set(ZOOM_PRESETS.map((p) => p.id));
const TRANS_IDS = new Set(TRANSITION_PRESETS.map((p) => p.id));

const EASING_FUNCTIONS: Record<string, (n: string) => string> = {
  linear: (n) => `(on/${n})`,
  easeIn: (n) => `((on/${n})*(on/${n}))`,
  easeOut: (n) => `(1-(1-on/${n})*(1-on/${n}))`,
  easeInOut: (n) => `if(lt(on/${n},0.5),2*(on/${n})*(on/${n}),1-2*(1-on/${n})*(1-on/${n}))`,
};

function progressExpr(n: number, speed: number, easing: string): string {
  const effectiveN = Math.round(n / speed);
  const clamped = `min(on,${effectiveN})`;
  const easingFn = EASING_FUNCTIONS[easing] || EASING_FUNCTIONS.linear;
  return easingFn(String(effectiveN)).replace(/on/g, clamped);
}

/**
 * Построить фильтр zoompan для одной сцены.
 * @param preset id движения
 * @param n число кадров клипа
 * @param p сила движения (0.05–0.35)
 * @param w,h размер кадра, fps
 * @param speed множитель скорости (0.5–2.0)
 * @param easing функция плавности
 * @param focusX точка фокуса X (0–100)
 * @param focusY точка фокуса Y (0–100)
 * @param shake дрожание камеры (0–100)
 */
export function buildZoomFilter(
  preset: string, n: number, p: number, w: number, h: number, fps: number,
  speed = 1.0, easing = 'linear', focusX = 50, focusY = 50, shake = 0,
): string {
  const t = progressExpr(n, speed, easing);
  const z1 = (1 + p).toFixed(4);
  const fxNorm = (focusX / 100).toFixed(4);
  const fyNorm = (focusY / 100).toFixed(4);
  const focusCx = `(iw*${fxNorm})-(iw/zoom/2)`;
  const focusCy = `(ih*${fyNorm})-(ih/zoom/2)`;
  let z = '1';
  let x = focusCx;
  let y = focusCy;
  switch (preset) {
    case 'in':
      z = `1+${p}*${t}`;
      break;
    case 'out':
      z = `${z1}-${p}*${t}`;
      break;
    case 'right':
      z = z1; x = `(iw-iw/zoom)*${t}`;
      break;
    case 'left':
      z = z1; x = `(iw-iw/zoom)*(1-${t})`;
      break;
    case 'down':
      z = z1; y = `(ih-ih/zoom)*${t}`;
      break;
    case 'up':
      z = z1; y = `(ih-ih/zoom)*(1-${t})`;
      break;
    case 'inUp':
      z = `1+${p}*${t}`; y = `(ih-ih/zoom)*(1-${t})`;
      break;
    case 'inDown':
      z = `1+${p}*${t}`; y = `(ih-ih/zoom)*${t}`;
      break;
    case 'slowDrift':
      z = z1;
      x = `(iw-iw/zoom)*(${fxNorm}+0.3*sin(2*PI*${t}))`;
      y = `(ih-ih/zoom)*(${fyNorm}+0.2*sin(3*PI*${t}))`;
      break;
    case 'breathe':
      z = `1+${p}*sin(PI*${t})*sin(PI*${t})`;
      break;
    case 'cinematic':
      z = `1+${p}*0.5*(1-cos(PI*${t}))`;
      x = `(iw-iw/zoom)*(${fxNorm}+0.15*sin(PI*${t}))`;
      y = `(ih-ih/zoom)*(${fyNorm}-0.1*(1-cos(PI*${t})))`;
      break;
    default:
      z = `1+${p}*${t}`;
  }
  // Камера-shake: высокочастотные синусы добавляются к x/y. shake — амплитуда в пикселях.
  if (shake > 0) {
    const amp = shake;
    const amp2 = (shake * 0.7).toFixed(2);
    const sx = `(${amp.toFixed(2)}*sin(${(7 / fps).toFixed(4)}*on*PI)+${amp2}*sin(${(11 / fps).toFixed(4)}*on*PI))`;
    const sy = `(${amp.toFixed(2)}*cos(${(9 / fps).toFixed(4)}*on*PI)+${amp2}*sin(${(13 / fps).toFixed(4)}*on*PI))`;
    x = `(${x})+${sx}`;
    y = `(${y})+${sy}`;
  }
  return (
    `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
    `zoompan=z='${z}':d=${n}:x='${x}':y='${y}':s=${w}x${h}:fps=${fps}`
  );
}

/** Статичный кадр без движения (зум выключен). */
export function staticFilter(w: number, h: number): string {
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Случайная выборка пресетов, по возможности не повторяя предыдущий. */
export function pickSequence<T>(pool: T[], count: number, rand?: () => number): T[] {
  if (pool.length === 0) return [];
  const rng = rand ?? Math.random;
  const out: T[] = [];
  let prev: T | undefined;
  for (let i = 0; i < count; i++) {
    let choice = pool[Math.floor(rng() * pool.length)];
    if (pool.length > 1 && choice === prev) {
      choice = pool[(pool.indexOf(choice) + 1) % pool.length];
    }
    out.push(choice);
    prev = choice;
  }
  return out;
}

export function validZoomPresets(arr: unknown): string[] {
  const list = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && ZOOM_IDS.has(x)) : [];
  return list.length ? list : ['in'];
}
export function validTransitionPresets(arr: unknown): string[] {
  const list = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && TRANS_IDS.has(x)) : [];
  return list.length ? list : ['fade'];
}

export interface EffectOverrides {
  zoom?: string;
  zoomIntensity?: number;
  speed?: number;
  easing?: string;
  focusX?: number;
  focusY?: number;
  cameraShake?: number;
  transition?: string;
  transitionDuration?: number;
  disableZoom?: boolean;
  disableTransition?: boolean;
  subtitlesX?: number;
  subtitlesY?: number;
  subtitlesStyle?: string;
  disableSubtitles?: boolean;
}

interface SceneForResolve {
  effectOverrides?: EffectOverrides | null;
}

interface ProjectSettings {
  zoomEnabled: boolean;
  zoomIntensity: number;
  zoomSpeed: number;
  zoomEasing: string;
  cameraShake: number;
  zoomPresets: unknown;
  transitionEnabled: boolean;
  transitionDuration: number;
  transitionPresets: unknown;
}

export interface ResolvedEffects {
  zoomSeq: (string | null)[];
  zoomIntensities: number[];
  zoomSpeeds: number[];
  zoomEasings: string[];
  zoomFocusX: number[];
  zoomFocusY: number[];
  zoomShakes: number[];
  transSeq: (string | null)[];
  transDurations: number[];
}

export function resolveEffects(scenes: SceneForResolve[], project: ProjectSettings, projectId?: string): ResolvedEffects {
  const seed = hashString(projectId || 'default');
  const rand = seededRandom(seed);

  const zoomPool = validZoomPresets(project.zoomPresets);
  const transPool = validTransitionPresets(project.transitionPresets);
  const randomZoom = pickSequence(zoomPool, scenes.length, rand);
  const randomTrans = pickSequence(transPool, Math.max(0, scenes.length - 1), rand);

  const zoomSeq: (string | null)[] = [];
  const zoomIntensities: number[] = [];
  const zoomSpeeds: number[] = [];
  const zoomEasings: string[] = [];
  const zoomFocusX: number[] = [];
  const zoomFocusY: number[] = [];
  const zoomShakes: number[] = [];
  const transSeq: (string | null)[] = [];
  const transDurations: number[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const ov = scenes[i].effectOverrides;
    if (!project.zoomEnabled || ov?.disableZoom) {
      zoomSeq.push(null);
    } else {
      zoomSeq.push(ov?.zoom && ZOOM_IDS.has(ov.zoom) ? ov.zoom : randomZoom[i]);
    }
    zoomIntensities.push(ov?.zoomIntensity ?? project.zoomIntensity);
    zoomSpeeds.push(ov?.speed ?? project.zoomSpeed ?? 1.0);
    zoomEasings.push(ov?.easing ?? project.zoomEasing ?? 'linear');
    zoomFocusX.push(ov?.focusX ?? 50);
    zoomFocusY.push(ov?.focusY ?? 50);
    zoomShakes.push(ov?.cameraShake ?? project.cameraShake ?? 0);

    if (i < scenes.length - 1) {
      if (!project.transitionEnabled || ov?.disableTransition) {
        transSeq.push(null);
        transDurations.push(0);
      } else {
        transSeq.push(ov?.transition && TRANS_IDS.has(ov.transition) ? ov.transition : randomTrans[i]);
        transDurations.push(ov?.transitionDuration ?? project.transitionDuration);
      }
    }
  }

  return { zoomSeq, zoomIntensities, zoomSpeeds, zoomEasings, zoomFocusX, zoomFocusY, zoomShakes, transSeq, transDurations };
}
