// Расчёт длительностей сцен.
//
// Алгоритм (если есть word_timestamps из Воксера — основной случай):
//   1) Идём по сценам слева направо. Для каждой сцены из её voiceText берём
//      слова и матчим по одному с массивом распознанных слов аудио.
//      Сравнение нормализованное (только буквы/цифры, lower-case) — чтобы
//      различия в пунктуации/регистре не сбивали матчинг.
//   2) Конец сцены = endSec последнего матчнутого слова + половина паузы
//      до первого слова следующей сцены (если пауза > MIN_SILENCE_TO_SPLIT).
//      Если пауза маленькая — режем сразу после слова.
//   3) Длинная пауза (>= LONG_PAUSE_SEC) полностью остаётся в текущей сцене:
//      дыхание/вдохи между фразами клеятся К ПРЕДЫДУЩЕЙ. Картинка не висит
//      «пустой» в начале следующей сцены.
//   4) Минимальная длительность сцены — настраивается через minSceneDurationSec
//      (по умолчанию 1.5с). Если фраза слишком короткая — добираем за счёт
//      соседних сцен. Помогает при перечислениях, когда отдельные слова длятся
//      долю секунды и картинки мельтешат.
//
// Fallback (без word_timestamps): пропорция по длине voiceText (как раньше)
// + старая привязка границ к паузам с окном ±25%. Минимум тоже применяется.
//
// durationOverride пользователя имеет абсолютный приоритет.

export interface SilenceRange {
  start: number;
  end: number;
  duration: number;
}

export interface WordTs {
  word: string;
  startSec: number;
  endSec: number;
}

export interface SceneTimingInput {
  voiceText: string;
  durationOverride?: number | null;
}

export interface SceneTimingResult {
  durations: number[];
  boundaries: number[];     // длина = scenes.length + 1, начинается с 0
  matchedSilences: (SilenceRange | null)[]; // длина = scenes.length - 1
}

const DEFAULT_MIN_SCENE_SEC = 1.5;
const MIN_SILENCE_TO_SPLIT = 0.15;
const LONG_PAUSE_SEC = 0.8;

const normWord = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const sceneWords = (text: string): string[] =>
  text.split(/\s+/).map(normWord).filter(Boolean);

/**
 * Расчёт длительностей.
 * @param scenes      Сцены в порядке отображения.
 * @param totalAudio  Общая длительность аудио (с). 0 = нет аудио (фолбэк-бюджет).
 * @param silences    Найденные паузы в аудио.
 * @param words       Пословные тайминги Воксера. Если есть — основной режим.
 * @param minSceneDurationSec Минимум длительности сцены (сек). По умолчанию 1.5.
 */
export function computeSceneDurations(
  scenes: SceneTimingInput[],
  totalAudio: number,
  silences: SilenceRange[] = [],
  words: WordTs[] | null = null,
  minSceneDurationSec: number = DEFAULT_MIN_SCENE_SEC,
): SceneTimingResult {
  const n = scenes.length;
  if (n === 0) return { durations: [], boundaries: [0], matchedSilences: [] };

  const minSec = Number.isFinite(minSceneDurationSec) && minSceneDurationSec > 0
    ? minSceneDurationSec
    : DEFAULT_MIN_SCENE_SEC;

  // Если есть пословные тайминги и аудио — пытаемся выровнять по словам.
  if (words && words.length > 0 && totalAudio > 0) {
    const aligned = alignByWords(scenes, totalAudio, words, minSec);
    if (aligned) return aligned;
  }

  // Fallback: пропорция по символам + привязка к паузам.
  return alignBySilences(scenes, totalAudio, silences, minSec);
}

/**
 * Алайнмент по словам: матчим слова сцен с word_timestamps.
 * Возвращает null если матчинг провалился (нашли < 60% слов сцены)
 * — тогда зовётся fallback.
 */
function alignByWords(
  scenes: SceneTimingInput[],
  totalAudio: number,
  words: WordTs[],
  minSceneSec: number,
): SceneTimingResult | null {
  const n = scenes.length;
  const overrides = scenes.map((s) =>
    s.durationOverride != null && s.durationOverride > 0 ? s.durationOverride : null,
  );

  // Подготовим нормализованные слова аудио.
  const audio = words
    .map((w) => ({ ...w, norm: normWord(w.word) }))
    .filter((w) => w.norm.length > 0);

  // Для каждой сцены найдём индекс последнего её слова в audio.
  // Жадно: курсор движется только вперёд.
  const lastWordIdx: number[] = new Array(n).fill(-1);
  let cursor = 0;
  let totalMatched = 0;
  let totalNeeded = 0;

  for (let s = 0; s < n; s++) {
    const sw = sceneWords(scenes[s].voiceText);
    totalNeeded += sw.length;
    if (sw.length === 0) {
      // Пустая сцена — границу оставим там же, где предыдущая.
      lastWordIdx[s] = -1;
      continue;
    }

    let matchedInScene = 0;
    let lastIdxHere = -1;
    for (const target of sw) {
      // Ищем target начиная с cursor, но не далеко (в окне до 25 слов вперёд).
      const horizon = Math.min(audio.length, cursor + 25);
      let foundAt = -1;
      for (let i = cursor; i < horizon; i++) {
        if (audio[i].norm === target) { foundAt = i; break; }
      }
      // Если точного матча нет — пробуем lev≤1 или префикс
      if (foundAt < 0) {
        for (let i = cursor; i < horizon; i++) {
          if (fuzzyEq(audio[i].norm, target)) { foundAt = i; break; }
        }
      }
      if (foundAt >= 0) {
        lastIdxHere = foundAt;
        cursor = foundAt + 1;
        matchedInScene++;
      }
      // если не нашли — едем дальше, не двигая курсор
    }
    totalMatched += matchedInScene;
    if (lastIdxHere >= 0) lastWordIdx[s] = lastIdxHere;
  }

  // Если матчинг слабый — выходим в fallback.
  if (totalNeeded === 0 || totalMatched / totalNeeded < 0.6) return null;

  // Заполним пустоты (сцены где ничего не нашли) — приклеим к предыдущей.
  for (let s = 0; s < n; s++) {
    if (lastWordIdx[s] < 0) {
      lastWordIdx[s] = s === 0 ? -1 : lastWordIdx[s - 1];
    }
  }

  // Считаем границы. boundaries[0] = 0, boundaries[n] = totalAudio.
  const boundaries: number[] = new Array(n + 1).fill(0);
  boundaries[n] = totalAudio;

  for (let i = 0; i < n - 1; i++) {
    const idxLast = lastWordIdx[i];
    if (idxLast < 0) {
      // ничего не нашли — пропорционально по словам
      boundaries[i + 1] = boundaries[i] + 0.001;
      continue;
    }
    const endOfThis = audio[idxLast].endSec;
    // Найдём первое слово СЛЕДУЮЩЕЙ сцены, у которой есть индекс.
    let nextStart: number | null = null;
    for (let j = i + 1; j < n; j++) {
      const li = lastWordIdx[j];
      if (li >= 0) {
        // Слова сцены j лежат где-то в audio. Возьмём начало первого её слова —
        // это «первое слово после idxLast». Проще — слово на позиции idxLast+1,
        // если оно вообще существует и принадлежит сцене j.
        const firstAfter = idxLast + 1;
        if (firstAfter < audio.length) nextStart = audio[firstAfter].startSec;
        break;
      }
    }
    if (nextStart == null) nextStart = endOfThis;

    const gap = Math.max(0, nextStart - endOfThis);
    let cut: number;
    if (gap >= LONG_PAUSE_SEC) {
      // Длинная пауза — отдаём её всю предыдущей сцене (дыхание после фразы)
      cut = nextStart - 0.05;
    } else if (gap >= MIN_SILENCE_TO_SPLIT) {
      cut = endOfThis + gap / 2;
    } else {
      cut = endOfThis;
    }
    boundaries[i + 1] = Math.max(boundaries[i] + 0.001, Math.min(cut, totalAudio));
  }

  // Применим override-сцены (фиксированная длительность сжимает соседей).
  applyOverrides(boundaries, overrides, totalAudio);

  // Минимальная длительность: если сцена слишком короткая, заберём
  // у следующей (а в конце — у предыдущей).
  enforceMinDuration(boundaries, overrides, minSceneSec);

  const durations = boundaries.slice(1).map((b, i) => b - boundaries[i]);
  return { durations, boundaries, matchedSilences: new Array(n - 1).fill(null) };
}

function fuzzyEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  // Один из другого префикс длиной ≥3
  if (a.length >= 3 && b.startsWith(a)) return true;
  if (b.length >= 3 && a.startsWith(b)) return true;
  // Расстояние Левенштейна ≤ 1 — для коротких слов слишком грубо, пропустим.
  if (a.length < 4 || b.length < 4) return false;
  return lev1(a, b);
}

// Расстояние Левенштейна <= 1
function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    edits++;
    if (edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else { i++; j++; }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

function applyOverrides(
  boundaries: number[],
  overrides: (number | null)[],
  totalAudio: number,
): void {
  const n = overrides.length;
  for (let i = 0; i < n; i++) {
    if (overrides[i] != null) {
      boundaries[i + 1] = Math.min(totalAudio, boundaries[i] + overrides[i]!);
    }
  }
  // Гарантируем монотонность
  for (let i = 1; i < boundaries.length; i++) {
    if (boundaries[i] < boundaries[i - 1]) boundaries[i] = boundaries[i - 1];
  }
}

function enforceMinDuration(
  boundaries: number[],
  overrides: (number | null)[],
  minSec: number,
): void {
  const n = overrides.length;

  // Только «мягкий» проход: короткая сцена забирает время у соседа, если у него
  // есть запас сверх минимума. Тайминги остаются привязаны к аудио — картинка
  // всегда идёт вместе с голосом.
  //
  // Раньше был жёсткий второй проход (сдвиг всех последующих границ вправо),
  // но он ломал синхрон: голос уходил вперёд от картинки на shift-секунд.
  // Если подряд идут короткие сцены (перечисление по 1 слову) — мельтешение
  // допустимо, а десинхрон нет.
  for (let i = 0; i < n - 1; i++) {
    if (overrides[i] != null) continue;
    const dur = boundaries[i + 1] - boundaries[i];
    if (dur < minSec) {
      const need = minSec - dur;
      const nextDur = boundaries[i + 2] - boundaries[i + 1];
      const giveable = overrides[i + 1] != null ? 0 : Math.max(0, nextDur - minSec);
      const give = Math.min(need, giveable);
      boundaries[i + 1] += give;
    }
  }
  // Последняя короткая — тянем у предыдущей (если есть запас).
  const last = n - 1;
  if (last > 0 && overrides[last] == null) {
    const dur = boundaries[last + 1] - boundaries[last];
    if (dur < minSec) {
      const need = minSec - dur;
      const prevDur = boundaries[last] - boundaries[last - 1];
      const giveable = overrides[last - 1] != null ? 0 : Math.max(0, prevDur - minSec);
      boundaries[last] -= Math.min(need, giveable);
    }
  }
}

// Старая логика (пропорция + паузы) — оставлена как fallback.
function alignBySilences(
  scenes: SceneTimingInput[],
  totalAudio: number,
  silences: SilenceRange[],
  minSceneSec: number,
): SceneTimingResult {
  const n = scenes.length;
  const overrides = scenes.map((s) =>
    s.durationOverride != null && s.durationOverride > 0 ? s.durationOverride : null,
  );
  const sumOverride = overrides.reduce<number>((a, b) => a + (b ?? 0), 0);

  const freeIdx: number[] = [];
  for (let i = 0; i < n; i++) if (overrides[i] == null) freeIdx.push(i);
  const freeWeights = freeIdx.map((i) => Math.max(scenes[i].voiceText?.length ?? 1, 1));
  const freeWeightSum = freeWeights.reduce((a, b) => a + b, 0) || 1;
  const hasAudio = totalAudio > 0;
  const freeBudget = hasAudio ? Math.max(0, totalAudio - sumOverride) : freeIdx.length * 4;

  const durations = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (overrides[i] != null) durations[i] = overrides[i]!;
    else {
      const k = freeIdx.indexOf(i);
      durations[i] = (freeWeights[k] / freeWeightSum) * freeBudget;
    }
  }

  const matched: (SilenceRange | null)[] = [];
  if (hasAudio && silences.length > 0 && n > 1) {
    let boundaries: number[] = [0];
    let acc = 0;
    for (const d of durations) { acc += d; boundaries.push(acc); }

    for (let i = 0; i < n - 1; i++) {
      const expected = boundaries[i + 1];
      const leftIsOverride = overrides[i] != null;
      const rightIsOverride = overrides[i + 1] != null;
      if (leftIsOverride && rightIsOverride) { matched.push(null); continue; }

      const window = Math.max(0.4, Math.min(durations[i], durations[i + 1]) * 0.25);
      const lo = Math.max(boundaries[i] + 0.05, expected - window);
      const hi = Math.min(boundaries[i + 2] - 0.05, expected + window);

      let best: SilenceRange | null = null;
      let bestScore = Infinity;
      for (const s of silences) {
        const mid = (s.start + s.end) / 2;
        if (mid < lo || mid > hi) continue;
        const dist = Math.abs(mid - expected);
        const score = dist - Math.min(s.duration, 1.0) * 0.15;
        if (score < bestScore) { bestScore = score; best = s; }
      }

      if (best) {
        const mid = (best.start + best.end) / 2;
        if (!leftIsOverride) durations[i] = mid - boundaries[i];
        if (!rightIsOverride) durations[i + 1] = boundaries[i + 2] - mid;
        else {
          durations[i] = boundaries[i + 1] - boundaries[i];
          matched.push(null); continue;
        }
        boundaries[i + 1] = mid;
        matched.push(best);
      } else {
        matched.push(null);
      }
    }
  }

  const finalBoundaries: number[] = [0];
  let acc2 = 0;
  for (const d of durations) { acc2 += d; finalBoundaries.push(acc2); }

  // Мин-хольд: заимствуем у соседей чтобы короткие сцены не мельтешили.
  enforceMinDuration(finalBoundaries, overrides, minSceneSec);
  const finalDurations = finalBoundaries.slice(1).map((b, i) => b - finalBoundaries[i]);

  return { durations: finalDurations, boundaries: finalBoundaries, matchedSilences: matched };
}
