// Зеркало backend/src/lib/sceneTiming.ts — расчёт длительностей сцен
// с привязкой границ к серединам реальных пауз в озвучке.
// Логика идентична бэку, чтобы превью и финальное видео совпадали.

export function computeSceneDurations(scenes, totalAudio, silences = []) {
  const n = scenes.length;
  if (n === 0) return { durations: [], boundaries: [0], matchedSilences: [] };

  const overrides = scenes.map((s) =>
    s.durationOverride != null && s.durationOverride > 0 ? s.durationOverride : null,
  );
  const sumOverride = overrides.reduce((a, b) => a + (b || 0), 0);

  const freeIdx = [];
  for (let i = 0; i < n; i++) if (overrides[i] == null) freeIdx.push(i);
  const freeWeights = freeIdx.map((i) => Math.max(scenes[i].voiceText?.length || 1, 1));
  const freeWeightSum = freeWeights.reduce((a, b) => a + b, 0) || 1;
  const hasAudio = totalAudio > 0;
  const freeBudget = hasAudio ? Math.max(0, totalAudio - sumOverride) : freeIdx.length * 4;

  const durations = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (overrides[i] != null) durations[i] = overrides[i];
    else {
      const k = freeIdx.indexOf(i);
      durations[i] = (freeWeights[k] / freeWeightSum) * freeBudget;
    }
  }

  const matched = [];
  if (hasAudio && silences.length > 0 && n > 1) {
    const boundaries = [0];
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

      let best = null;
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
        if (leftIsOverride) { matched.push(null); continue; }
        if (rightIsOverride) {
          durations[i] = boundaries[i + 1] - boundaries[i];
          matched.push(null);
          continue;
        }
        durations[i] = mid - boundaries[i];
        durations[i + 1] = boundaries[i + 2] - mid;
        boundaries[i + 1] = mid;
        matched.push(best);
      } else {
        matched.push(null);
      }
    }
  }

  const finalBoundaries = [0];
  let acc2 = 0;
  for (const d of durations) { acc2 += d; finalBoundaries.push(acc2); }
  return { durations, boundaries: finalBoundaries, matchedSilences: matched };
}
