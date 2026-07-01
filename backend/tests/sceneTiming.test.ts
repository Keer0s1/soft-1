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

// Утилита для собирания word_timestamps
const ws = (...arr: Array<[string, number, number]>) =>
  arr.map(([w, s, e]) => ({ word: w, startSec: s, endSec: e }));

describe('computeSceneDurations — выравнивание по словам', () => {
  it('режет границы между концом слов одной сцены и началом другой', () => {
    // Каждая сцена >= 1.2с естественно — минималка не вмешивается.
    const scenes = [
      { voiceText: 'Привет мир' },
      { voiceText: 'Как дела друзья' },
      { voiceText: 'Хорошо спасибо большое' },
    ];
    const words = ws(
      ['Привет',  0.0, 0.6],
      ['мир',     0.6, 1.2],
      ['Как',     1.7, 2.0],
      ['дела',    2.0, 2.4],
      ['друзья',  2.4, 3.0],
      ['Хорошо',  3.4, 3.9],
      ['спасибо', 3.9, 4.5],
      ['большое', 4.5, 5.1],
    );
    const r = computeSceneDurations(scenes, 5.3, [], words, 1.2);
    // граница 1↔2: gap=0.5с (1.2→1.7) → cut = 1.2 + 0.25 = 1.45
    expect(r.boundaries[1]).toBeCloseTo(1.45, 1);
    // граница 2↔3: gap=0.4с (3.0→3.4) → cut = 3.0 + 0.2 = 3.2
    expect(r.boundaries[2]).toBeCloseTo(3.2, 1);
    expect(r.boundaries[0]).toBe(0);
    expect(r.boundaries[3]).toBeCloseTo(5.3, 5);
  });

  it('длинная пауза (>=0.8с) клеится к предыдущей сцене целиком', () => {
    const scenes = [
      { voiceText: 'Алиса крутая девочка' },
      { voiceText: 'Она добрая всегда помогает' },
    ];
    const words = ws(
      ['Алиса',     0.0, 0.4],
      ['крутая',    0.4, 1.0],
      ['девочка',   1.0, 1.7],
      ['Она',       2.9, 3.1],   // дыхание 1.2с — всё в первую
      ['добрая',    3.1, 3.6],
      ['всегда',    3.6, 4.0],
      ['помогает',  4.0, 4.6],
    );
    const r = computeSceneDurations(scenes, 4.8, [], words);
    expect(r.boundaries[1]).toBeGreaterThan(2.7);
    expect(r.boundaries[1]).toBeLessThanOrEqual(2.9);
  });

  it('игнорирует пунктуацию в voiceText при матчинге', () => {
    const scenes = [
      { voiceText: 'Привет, мир! Это сцена один' },
      { voiceText: 'Как? Дела. Это сцена два' },
    ];
    const words = ws(
      ['Привет', 0.0, 0.5],
      ['мир',    0.5, 0.9],
      ['Это',    0.9, 1.1],
      ['сцена',  1.1, 1.5],
      ['один',   1.5, 1.9],
      ['Как',    2.4, 2.7],
      ['дела',   2.7, 3.1],
      ['Это',    3.1, 3.3],
      ['сцена',  3.3, 3.7],
      ['два',    3.7, 4.0],
    );
    const r = computeSceneDurations(scenes, 4.2, [], words);
    // gap = 0.5с (1.9→2.4) → cut = 1.9 + 0.25 = 2.15
    expect(r.boundaries[1]).toBeCloseTo(2.15, 1);
  });

  it('перечисление коротких сцен подряд: сохраняем синхрон с аудио, а не min-hold', () => {
    // 5 сцен по 1 слову ~0.3с — все короткие подряд, забрать не у кого.
    // Мягкий проход не может растянуть (у соседей нет запаса). Сохраняем
    // синхрон с аудио: длительности остаются короткими, сумма == totalAudio.
    // Мельтешение допустимо, десинхрон — нет.
    const scenes = [
      { voiceText: 'орехи' },
      { voiceText: 'батарейки' },
      { voiceText: 'щётка' },
      { voiceText: 'мыло' },
      { voiceText: 'крем' },
    ];
    const words = ws(
      ['орехи',     0.0, 0.4],
      ['батарейки', 0.4, 0.9],
      ['щётка',     0.9, 1.2],
      ['мыло',      1.2, 1.5],
      ['крем',      1.5, 1.8],
    );
    const r = computeSceneDurations(scenes, 1.8, [], words, 1.7);
    const total = r.durations.reduce((a, b) => a + b, 0);
    // Общее видео == длине аудио (± мелкая погрешность): синхрон сохранён
    expect(total).toBeCloseTo(1.8, 1);
    // Границы монотонные
    for (let i = 1; i < r.boundaries.length; i++) {
      expect(r.boundaries[i]).toBeGreaterThanOrEqual(r.boundaries[i - 1]);
    }
  });

  it('минималка 1.2с: короткая фраза тянет время у соседа', () => {
    const scenes = [
      { voiceText: 'Да' },
      { voiceText: 'Очень длинная фраза которая идёт долго' },
    ];
    const words = ws(
      ['Да',       0.0, 0.3],
      ['Очень',    0.5, 0.8],
      ['длинная',  0.8, 1.2],
      ['фраза',    1.2, 1.5],
      ['которая',  1.5, 1.9],
      ['идёт',     1.9, 2.2],
      ['долго',    2.2, 2.8],
    );
    const r = computeSceneDurations(scenes, 3.0, [], words);
    const d0 = r.boundaries[1] - r.boundaries[0];
    expect(d0).toBeGreaterThanOrEqual(1.2 - 1e-6);
  });

  it('durationOverride остаётся неизменным даже с word_timestamps', () => {
    const scenes = [
      { voiceText: 'Один', durationOverride: 2.0 },
      { voiceText: 'Два' },
    ];
    const words = ws(
      ['Один', 0.0, 0.3],
      ['Два',  0.5, 0.8],
    );
    const r = computeSceneDurations(scenes, 3.0, [], words);
    expect(r.durations[0]).toBeCloseTo(2.0, 2);
  });

  it('слабый матчинг → fallback на пропорцию', () => {
    // Все слова в word_timestamps не совпадают с voiceText
    const scenes = [
      { voiceText: 'aaaa' },
      { voiceText: 'bb' },
    ];
    const words = ws(['xxx', 0.0, 0.5], ['yyy', 0.5, 1.0]);
    const r = computeSceneDurations(scenes, 6, [], words);
    // Пропорция 4:2 = 4с и 2с
    expect(r.durations[0]).toBeCloseTo(4, 1);
    expect(r.durations[1]).toBeCloseTo(2, 1);
  });

  it('реалистично: 8 сцен с пропусками, опечатками, дыханиями — ничего не уезжает', () => {
    // 8 сцен, каждая 2 слова. Симулирую то что обычно даёт Воксер:
    // — иногда не распознаёт слово
    // — иногда лёгкая опечатка/окончание
    // — длинные паузы между фразами (вдохи)
    const scenes = [
      { voiceText: 'Привет друзья' },              // ok
      { voiceText: 'Сегодня поговорим' },          // одно пропущено в аудио
      { voiceText: 'О новых технологиях' },        // ok, длинный вдох до
      { voiceText: 'Искусственный интеллект' },    // опечатка в окончании
      { voiceText: 'Меняет мир' },                 // ok
      { voiceText: 'Каждый день каждый час' },     // ok, плотно
      { voiceText: 'Это удивительно' },            // ok
      { voiceText: 'Спасибо за внимание' },        // ok, длинный хвост
    ];
    const words = ws(
      ['Привет',          0.0,  0.4],
      ['друзья',          0.4,  1.0],
      // пауза 0.6с
      ['Сегодня',         1.6,  2.1],
      // "поговорим" пропущено воксером
      // длинная пауза 1.2с (дыхание)
      ['О',               3.3,  3.4],
      ['новых',           3.4,  3.8],
      ['технологиях',     3.8,  4.7],
      // пауза 0.5
      ['Искусственныи',   5.2,  5.9],   // опечатка вместо "Искусственный"
      ['интеллект',       5.9,  6.6],
      // пауза 0.3
      ['Меняет',          6.9,  7.3],
      ['мир',             7.3,  7.7],
      // пауза 0.4
      ['Каждый',          8.1,  8.5],
      ['день',            8.5,  8.9],
      ['каждый',          8.9,  9.3],
      ['час',             9.3,  9.7],
      // пауза 0.5
      ['Это',            10.2, 10.4],
      ['удивительно',    10.4, 11.2],
      // длинная пауза 1.0с
      ['Спасибо',        12.2, 12.7],
      ['за',             12.7, 12.9],
      ['внимание',       12.9, 13.6],
    );
    const r = computeSceneDurations(scenes, 14.0, [], words);

    // Все 8 длительностей должны быть >= 1.2с (минималка)
    for (let i = 0; i < scenes.length; i++) {
      expect(r.durations[i]).toBeGreaterThanOrEqual(1.2 - 1e-6);
    }
    // Сумма == total audio
    const sum = r.durations.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(14.0, 1);
    // Границы монотонны
    for (let i = 1; i < r.boundaries.length; i++) {
      expect(r.boundaries[i]).toBeGreaterThanOrEqual(r.boundaries[i - 1]);
    }
    // Длинная пауза перед "О новых технологиях" (2.1→3.3, 1.2с) — клеится
    // к предыдущей сцене (2). Граница 2↔3 должна быть в районе 3.2-3.3.
    expect(r.boundaries[2]).toBeGreaterThan(2.8);
    expect(r.boundaries[2]).toBeLessThanOrEqual(3.3);
    // Опечатка не должна сломать матчинг — сцена 4 содержит "интеллект",
    // граница 4↔5 рядом с 6.6
    expect(r.boundaries[4]).toBeGreaterThan(6.5);
    expect(r.boundaries[4]).toBeLessThan(7.0);
    // Финальная сцена "Спасибо за внимание" — длинная пауза перед ней
    // (11.2→12.2) должна остаться у предыдущей.
    expect(r.boundaries[7]).toBeGreaterThan(11.9);
    expect(r.boundaries[7]).toBeLessThanOrEqual(12.2);
  });
});
