// Зеркало backend/src/lib/sceneTiming.ts — расчёт длительностей сцен.
// Основной режим — выравнивание по словам Воксера. Fallback — пропорция
// по символам + привязка к паузам. Логика идентична бэку, чтобы превью
// и финальное видео совпадали.

const DEFAULT_MIN_SCENE_SEC = 1.5;
const MIN_SILENCE_TO_SPLIT = 0.15;
const LONG_PAUSE_SEC = 0.8;

const normWord = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const sceneWords = (text) => String(text).split(/\s+/).map(normWord).filter(Boolean);

export function computeSceneDurations(scenes, totalAudio, silences = [], words = null, minSceneDurationSec = DEFAULT_MIN_SCENE_SEC) {
  const n = scenes.length;
  if (n === 0) return { durations: [], boundaries: [0], matchedSilences: [] };

  const minSec = Number.isFinite(minSceneDurationSec) && minSceneDurationSec > 0
    ? minSceneDurationSec
    : DEFAULT_MIN_SCENE_SEC;

  if (words && words.length > 0 && totalAudio > 0) {
    const aligned = alignByWords(scenes, totalAudio, words, minSec);
    if (aligned) return aligned;
  }
  return alignBySilences(scenes, totalAudio, silences, minSec);
}

function alignByWords(scenes, totalAudio, words, minSceneSec) {
  const n = scenes.length;
  const overrides = scenes.map((s) =>
    s.durationOverride != null && s.durationOverride > 0 ? s.durationOverride : null,
  );

  const audio = words
    .map((w) => ({
      word: w.word,
      startSec: Number(w.startSec ?? w.start ?? 0),
      endSec: Number(w.endSec ?? w.end ?? 0),
      norm: normWord(w.word),
    }))
    .filter((w) => w.norm.length > 0);

  const lastWordIdx = new Array(n).fill(-1);
  let cursor = 0;
  let totalMatched = 0;
  let totalNeeded = 0;

  for (let s = 0; s < n; s++) {
    const sw = sceneWords(scenes[s].voiceText || '');
    totalNeeded += sw.length;
    if (sw.length === 0) { lastWordIdx[s] = -1; continue; }

    let lastIdxHere = -1;
    let matchedInScene = 0;
    for (const target of sw) {
      const horizon = Math.min(audio.length, cursor + 25);
      let foundAt = -1;
      for (let i = cursor; i < horizon; i++) {
        if (audio[i].norm === target) { foundAt = i; break; }
      }
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
    }
    totalMatched += matchedInScene;
    if (lastIdxHere >= 0) lastWordIdx[s] = lastIdxHere;
  }

  if (totalNeeded === 0 || totalMatched / totalNeeded < 0.6) return null;

  for (let s = 0; s < n; s++) {
    if (lastWordIdx[s] < 0) lastWordIdx[s] = s === 0 ? -1 : lastWordIdx[s - 1];
  }

  const boundaries = new Array(n + 1).fill(0);
  boundaries[n] = totalAudio;

  for (let i = 0; i < n - 1; i++) {
    const idxLast = lastWordIdx[i];
    if (idxLast < 0) { boundaries[i + 1] = boundaries[i] + 0.001; continue; }
    const endOfThis = audio[idxLast].endSec;
    let nextStart = null;
    for (let j = i + 1; j < n; j++) {
      if (lastWordIdx[j] >= 0) {
        const firstAfter = idxLast + 1;
        if (firstAfter < audio.length) nextStart = audio[firstAfter].startSec;
        break;
      }
    }
    if (nextStart == null) nextStart = endOfThis;

    const gap = Math.max(0, nextStart - endOfThis);
    let cut;
    if (gap >= LONG_PAUSE_SEC) cut = nextStart - 0.05;
    else if (gap >= MIN_SILENCE_TO_SPLIT) cut = endOfThis + gap / 2;
    else cut = endOfThis;
    boundaries[i + 1] = Math.max(boundaries[i] + 0.001, Math.min(cut, totalAudio));
  }

  applyOverrides(boundaries, overrides, totalAudio);
  enforceMinDuration(boundaries, overrides, minSceneSec);

  const durations = boundaries.slice(1).map((b, i) => b - boundaries[i]);
  return { durations, boundaries, matchedSilences: new Array(n - 1).fill(null) };
}

function fuzzyEq(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  if (a.length >= 3 && b.startsWith(a)) return true;
  if (b.length >= 3 && a.startsWith(b)) return true;
  if (a.length < 4 || b.length < 4) return false;
  return lev1(a, b);
}

function lev1(a, b) {
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

function applyOverrides(boundaries, overrides, totalAudio) {
  const n = overrides.length;
  for (let i = 0; i < n; i++) {
    if (overrides[i] != null) {
      boundaries[i + 1] = Math.min(totalAudio, boundaries[i] + overrides[i]);
    }
  }
  for (let i = 1; i < boundaries.length; i++) {
    if (boundaries[i] < boundaries[i - 1]) boundaries[i] = boundaries[i - 1];
  }
}

function enforceMinDuration(boundaries, overrides, minSec) {
  const n = overrides.length;
  for (let i = 0; i < n - 1; i++) {
    if (overrides[i] != null) continue;
    const dur = boundaries[i + 1] - boundaries[i];
    if (dur < minSec) {
      const need = minSec - dur;
      const nextDur = boundaries[i + 2] - boundaries[i + 1];
      const giveable = overrides[i + 1] != null ? 0 : Math.max(0, nextDur - minSec);
      boundaries[i + 1] += Math.min(need, giveable);
    }
  }
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

function alignBySilences(scenes, totalAudio, silences, minSceneSec) {
  const n = scenes.length;
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
  enforceMinDuration(finalBoundaries, overrides, minSceneSec);
  const finalDurations = finalBoundaries.slice(1).map((b, i) => b - finalBoundaries[i]);
  return { durations: finalDurations, boundaries: finalBoundaries, matchedSilences: matched };
}
