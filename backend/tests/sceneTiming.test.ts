import { describe, it, expect } from 'vitest';
import { computeSceneDurations } from '../src/lib/sceneTiming.js';

describe('computeSceneDurations', () => {
  it('пропорция по символам когда нет пауз', () => {
    const r = computeSceneDurations(
      [{ voiceText: 'aaaa' }, { voiceText: 'bb' }],
      6, // 6 секунд аудио, веса 4 и 2 → 4с и 2с
      [],
    );
    expect(r.durations[0]).toBeCloseTo(4, 5);
    expect(r.durations[1]).toBeCloseTo(2, 5);
    expect(r.boundaries).toEqual([0, 4, 6]);
  });

  it('привязывает границу к середине ближайшей паузы', () => {
    // Без пауз граница была бы на 5с (50/50 веса). С паузой 4.5–4.9 (mid=4.7)
    // в окне ±25% от меньшей сцены — граница уезжает на 4.7.
    const r = computeSceneDurations(
      [{ voiceText: 'aaaaa' }, { voiceText: 'bbbbb' }],
      10,
      [{ start: 4.5, end: 4.9, duration: 0.4 }],
    );
    expect(r.boundaries[1]).toBeCloseTo(4.7, 5);
    expect(r.durations[0]).toBeCloseTo(4.7, 5);
    expect(r.durations[1]).toBeCloseTo(5.3, 5);
    expect(r.matchedSilences[0]).not.toBeNull();
  });

  it('игнорирует паузу вне окна поиска', () => {
    // Пауза далеко за окном — оставит пропорциональный расчёт
    const r = computeSceneDurations(
      [{ voiceText: 'a' }, { voiceText: 'b' }],
      10,
      [{ start: 0.1, end: 0.3, duration: 0.2 }],
    );
    expect(r.boundaries[1]).toBeCloseTo(5, 5);
    expect(r.matchedSilences[0]).toBeNull();
  });

  it('durationOverride имеет приоритет и не двигается', () => {
    const r = computeSceneDurations(
      [
        { voiceText: 'a', durationOverride: 3 },
        { voiceText: 'b', durationOverride: 2 },
      ],
      5,
      [{ start: 2, end: 2.5, duration: 0.5 }],
    );
    expect(r.durations).toEqual([3, 2]);
    expect(r.boundaries).toEqual([0, 3, 5]);
    expect(r.matchedSilences[0]).toBeNull();
  });

  it('выбирает паузу ближайшую к ожидаемой границе', () => {
    // Две паузы в окне — должна выбраться ближайшая к 5с
    const r = computeSceneDurations(
      [{ voiceText: 'aaaaa' }, { voiceText: 'bbbbb' }],
      10,
      [
        { start: 4.0, end: 4.3, duration: 0.3 },
        { start: 5.4, end: 5.6, duration: 0.2 },
      ],
    );
    // 5.5 (mid второй паузы) ближе к expected=5, чем 4.15 (mid первой)
    expect(r.boundaries[1]).toBeCloseTo(5.5, 5);
  });

  it('пустой массив сцен', () => {
    const r = computeSceneDurations([], 10, []);
    expect(r.durations).toEqual([]);
    expect(r.boundaries).toEqual([0]);
  });

  it('без аудио использует бюджет 4с на сцену', () => {
    const r = computeSceneDurations([{ voiceText: 'a' }, { voiceText: 'b' }], 0, []);
    expect(r.durations[0]).toBeCloseTo(4, 5);
    expect(r.durations[1]).toBeCloseTo(4, 5);
  });
});
