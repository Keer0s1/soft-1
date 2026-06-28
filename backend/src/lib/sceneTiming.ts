// Расчёт длительностей сцен с привязкой границ к реальным паузам в озвучке.
// Алгоритм:
//   1) считаем «ожидаемые» границы пропорционально длине voiceText каждой сцены
//      от общей длины аудио (минус сумма ручных durationOverride);
//   2) для каждой ожидаемой границы ищем ближайшую паузу в окне ±tolerance
//      от ожидаемой позиции (по умолчанию 25% длительности соседних сцен);
//   3) если пауза найдена — граница = середина паузы. Иначе — оставляем
//      пропорциональное значение.
//   4) durationOverride пользователя имеет абсолютный приоритет и не сдвигается.

export interface SilenceRange {
  start: number;
  end: number;
  duration: number;
}

export interface SceneTimingInput {
  voiceText: string;
  durationOverride?: number | null;
}

export interface SceneTimingResult {
  durations: number[];
  boundaries: number[];     // длина = scenes.length + 1, начинается с 0
  matchedSilences: (SilenceRange | null)[]; // паузы, к которым привязаны внутренние границы (длина = scenes.length - 1)
}

/**
 * @param scenes      Массив сцен в порядке отображения.
 * @param totalAudio  Общая длительность аудио в секундах. Если 0/нет —
 *                    используется бюджет 4с/сцена для свободных сцен.
 * @param silences    Список найденных пауз в аудио (можно пустой массив).
 */
export function computeSceneDurations(
  scenes: SceneTimingInput[],
  totalAudio: number,
  silences: SilenceRange[] = [],
): SceneTimingResult {
  const n = scenes.length;
  if (n === 0) {
    return { durations: [], boundaries: [0], matchedSilences: [] };
  }

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

  // Пропорциональные длительности (стартовая точка).
  const durations = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (overrides[i] != null) durations[i] = overrides[i]!;
    else {
      const k = freeIdx.indexOf(i);
      durations[i] = (freeWeights[k] / freeWeightSum) * freeBudget;
    }
  }

  const matched: (SilenceRange | null)[] = [];
  // Привязка границ к паузам: только если есть аудио и есть паузы.
  // Override-сцены не двигаем (их граница фиксированная), но соседняя
  // free-сцена может «отдать»/«забрать» время через привязку.
  if (hasAudio && silences.length > 0 && n > 1) {
    // Текущие boundaries
    let boundaries: number[] = [0];
    let acc = 0;
    for (const d of durations) { acc += d; boundaries.push(acc); }

    // Для каждой внутренней границы пытаемся привязать к паузе
    for (let i = 0; i < n - 1; i++) {
      const expected = boundaries[i + 1];
      // Если одна из двух сцен по сторонам границы — override, разрешаем
      // двигать только в сторону free-сцены, иначе override-длительность
      // изменится. Проще: вообще не двигаем границы между двумя override.
      const leftIsOverride = overrides[i] != null;
      const rightIsOverride = overrides[i + 1] != null;
      if (leftIsOverride && rightIsOverride) { matched.push(null); continue; }

      // Окно поиска паузы: ±25% от меньшей из соседних сцен, но не меньше 0.4с
      const window = Math.max(0.4, Math.min(durations[i], durations[i + 1]) * 0.25);
      const lo = Math.max(boundaries[i] + 0.05, expected - window);
      const hi = Math.min(boundaries[i + 2] - 0.05, expected + window);

      let best: SilenceRange | null = null;
      let bestScore = Infinity;
      for (const s of silences) {
        const mid = (s.start + s.end) / 2;
        if (mid < lo || mid > hi) continue;
        // Скор: расстояние до expected, минус бонус за длину паузы.
        const dist = Math.abs(mid - expected);
        const score = dist - Math.min(s.duration, 1.0) * 0.15;
        if (score < bestScore) { bestScore = score; best = s; }
      }

      if (best) {
        const mid = (best.start + best.end) / 2;
        // Сдвигаем границу: пересчитываем длительности соседних сцен
        // с учётом фиксированных границ слева (boundaries[i]) и справа (boundaries[i+2]).
        if (!leftIsOverride) durations[i] = mid - boundaries[i];
        else {
          // left override: его длительность не трогаем, но граница уже в нужном месте,
          // т.к. boundaries[i+1] = boundaries[i] + durations[i]. Если граница сдвинулась,
          // это нарушит override — поэтому такой случай мы выше уже исключили частично,
          // но если только left override — двигать нельзя. Пропускаем.
          matched.push(null); continue;
        }
        if (!rightIsOverride) durations[i + 1] = boundaries[i + 2] - mid;
        else {
          matched.push(null);
          // Откатим изменение durations[i], раз правая сцена override
          // и сдвиг границы поломал бы её фиксированную длительность.
          // Восстанавливаем из прежних boundaries.
          durations[i] = boundaries[i + 1] - boundaries[i];
          continue;
        }
        boundaries[i + 1] = mid;
        matched.push(best);
      } else {
        matched.push(null);
      }
    }
  }

  // Финальные boundaries
  const finalBoundaries: number[] = [0];
  let acc2 = 0;
  for (const d of durations) { acc2 += d; finalBoundaries.push(acc2); }

  return { durations, boundaries: finalBoundaries, matchedSilences: matched };
}
