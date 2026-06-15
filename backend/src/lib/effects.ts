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
];

export interface TransitionPreset {
  id: string; // имя xfade-перехода
  label: string;
}

export const TRANSITION_PRESETS: TransitionPreset[] = [
  { id: 'fade', label: 'Плавное затухание' },
  { id: 'fadeblack', label: 'Через чёрный' },
  { id: 'dissolve', label: 'Растворение' },
  { id: 'wipeleft', label: 'Шторка влево' },
  { id: 'wiperight', label: 'Шторка вправо' },
  { id: 'slideleft', label: 'Сдвиг влево' },
  { id: 'slideup', label: 'Сдвиг вверх' },
  { id: 'circleopen', label: 'Круг' },
  { id: 'radial', label: 'Радиально' },
  { id: 'pixelize', label: 'Пиксели' },
];

const ZOOM_IDS = new Set(ZOOM_PRESETS.map((p) => p.id));
const TRANS_IDS = new Set(TRANSITION_PRESETS.map((p) => p.id));

const cx = 'iw/2-(iw/zoom/2)';
const cy = 'ih/2-(ih/zoom/2)';

/**
 * Построить фильтр zoompan для одной сцены.
 * @param preset id движения
 * @param n число кадров клипа
 * @param p сила движения (0.05–0.35)
 * @param w,h размер кадра, fps
 */
export function buildZoomFilter(preset: string, n: number, p: number, w: number, h: number, fps: number): string {
  const z1 = (1 + p).toFixed(4); // зум в конце/постоянный
  let z = '1';
  let x = cx;
  let y = cy;
  switch (preset) {
    case 'in':
      z = `1+${p}*on/${n}`;
      break;
    case 'out':
      z = `${z1}-${p}*on/${n}`;
      break;
    case 'right':
      z = z1; x = `(iw-iw/zoom)*on/${n}`;
      break;
    case 'left':
      z = z1; x = `(iw-iw/zoom)*(1-on/${n})`;
      break;
    case 'down':
      z = z1; y = `(ih-ih/zoom)*on/${n}`;
      break;
    case 'up':
      z = z1; y = `(ih-ih/zoom)*(1-on/${n})`;
      break;
    case 'inUp':
      z = `1+${p}*on/${n}`; y = `(ih-ih/zoom)*(1-on/${n})`;
      break;
    case 'inDown':
      z = `1+${p}*on/${n}`; y = `(ih-ih/zoom)*on/${n}`;
      break;
    default:
      z = `1+${p}*on/${n}`;
  }
  // cover WxH -> zoompan. d=n кадров, итог n/fps секунд.
  return (
    `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
    `zoompan=z='${z}':d=${n}:x='${x}':y='${y}':s=${w}x${h}:fps=${fps}`
  );
}

/** Статичный кадр без движения (зум выключен). */
export function staticFilter(w: number, h: number): string {
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
}

/** Случайная выборка пресетов, по возможности не повторяя предыдущий. */
export function pickSequence<T>(pool: T[], count: number): T[] {
  if (pool.length === 0) return [];
  const out: T[] = [];
  let prev: T | undefined;
  for (let i = 0; i < count; i++) {
    let choice = pool[Math.floor(Math.random() * pool.length)];
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
