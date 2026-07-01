import { describe, it, expect } from 'vitest';
import { generateASS } from '../src/lib/subtitles.js';

describe('subtitles', () => {
  const scenes = [
    { text: 'Привет мир', startSec: 0, endSec: 3.5 },
    { text: 'Вторая сцена тут', startSec: 3.5, endSec: 8.2 },
  ];

  it('генерирует валидный ASS с заголовком', () => {
    const ass = generateASS(scenes, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080 });
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('PlayResY: 1080');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
  });

  it('генерирует Dialogue для каждой сцены (с holdGap=false — точные исходные тайминги)', () => {
    const ass = generateASS(scenes, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080, holdGap: false });
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:03.50');
    expect(ass).toContain('Dialogue: 0,0:00:03.50,0:00:08.20');
    expect(ass).toContain('Привет мир');
    expect(ass).toContain('Вторая сцена тут');
  });

  it('использует \\pos() с координатами из x/y', () => {
    const ass = generateASS(scenes, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080 });
    expect(ass).toContain('\\pos(960,918)');
    const topAss = generateASS(scenes, { style: 'modern', fontSize: 48, position: 'top', x: 30, y: 15, resX: 1920, resY: 1080 });
    expect(topAss).toContain('\\pos(576,162)');
  });

  it('включает fade-анимацию', () => {
    const ass = generateASS(scenes, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080 });
    expect(ass).toContain('\\fad(300,200)');
  });

  it('пропускает пустые тексты', () => {
    const withEmpty = [
      { text: '', startSec: 0, endSec: 2 },
      { text: 'Текст', startSec: 2, endSec: 5 },
    ];
    const ass = generateASS(withEmpty, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080 });
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(dialogueLines).toHaveLength(1);
  });

  it('поддерживает разные стили', () => {
    for (const style of ['modern', 'classic', 'bold', 'minimal'] as const) {
      const ass = generateASS(scenes, { style, fontSize: 36, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080 });
      expect(ass).toContain('Style: Default');
    }
  });

  it('корректно форматирует время > 1 минуты', () => {
    const long = [{ text: 'Долго', startSec: 65.5, endSec: 130.25 }];
    const ass = generateASS(long, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080 });
    expect(ass).toContain('0:01:05.50');
    expect(ass).toContain('0:02:10.25');
  });

  it('offsetSec сдвигает все тайминги', () => {
    const ass = generateASS(scenes, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080, offsetSec: 0.5, holdGap: false });
    expect(ass).toContain('Dialogue: 0,0:00:00.50,0:00:04.00');
    expect(ass).toContain('Dialogue: 0,0:00:04.00,0:00:08.70');
  });

  it('отрицательный offset клампится до нуля в форматтере', () => {
    const ass = generateASS(scenes, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080, offsetSec: -1.0, holdGap: false });
    // 0 - 1 = -1 → clamp to 0
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.50');
  });

  it('holdGap продлевает фразу до старта следующей (в пределах 2с)', () => {
    const gapped = [
      { text: 'Первая', startSec: 0, endSec: 1.0 },
      { text: 'Вторая', startSec: 3.0, endSec: 4.0 },
    ];
    const ass = generateASS(gapped, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080 });
    // gap 2с (1.0 -> 3.0), holdGap продлит до 3.0-0.05 = 2.95
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.95');
  });

  it('holdGap ограничен 2 секундами', () => {
    const gapped = [
      { text: 'Первая', startSec: 0, endSec: 1.0 },
      { text: 'Вторая', startSec: 10.0, endSec: 11.0 },
    ];
    const ass = generateASS(gapped, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080 });
    // gap 9с — продлит только на MAX_HOLD_SEC=2, итог 3.00
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:03.00');
  });
});

describe('synthesizeWordTimestamps', () => {
  it('возвращает пустой массив когда нет текста', async () => {
    const { synthesizeWordTimestamps } = await import('../src/lib/subtitles.js');
    expect(synthesizeWordTimestamps('', 10, [])).toEqual([]);
  });

  it('без пауз распределяет слова по длине символов пропорционально', async () => {
    const { synthesizeWordTimestamps } = await import('../src/lib/subtitles.js');
    // 3 слова: "aaa" (3) + "bb" (2) + "c" (1) = 6 символов, аудио 6 сек
    // → 3с, 2с, 1с
    const out = synthesizeWordTimestamps('aaa bb c', 6, []);
    expect(out).toHaveLength(3);
    expect(out[0].endSec - out[0].startSec).toBeCloseTo(3, 1);
    expect(out[1].endSec - out[1].startSec).toBeCloseTo(2, 1);
    expect(out[2].endSec - out[2].startSec).toBeCloseTo(1, 1);
  });

  it('с паузами делит слова на сегменты и распределяет по каждому', async () => {
    const { synthesizeWordTimestamps } = await import('../src/lib/subtitles.js');
    // Аудио 10с, пауза 4-6с. Первый сегмент 0-4 (4с), второй 6-10 (4с).
    // 4 слова 'aa bb cc dd' — по 2 в сегмент по идее.
    const out = synthesizeWordTimestamps('aa bb cc dd', 10, [{ start: 4, end: 6, duration: 2 }]);
    expect(out).toHaveLength(4);
    // Первое слово в первом сегменте
    expect(out[0].startSec).toBeGreaterThanOrEqual(0);
    expect(out[0].endSec).toBeLessThanOrEqual(4);
    // Последнее слово во втором сегменте
    expect(out[out.length - 1].endSec).toBeLessThanOrEqual(10);
    expect(out[out.length - 1].startSec).toBeGreaterThanOrEqual(6);
  });

  it('монотонность: startSec следующего слова >= endSec предыдущего в одном сегменте', async () => {
    const { synthesizeWordTimestamps } = await import('../src/lib/subtitles.js');
    const out = synthesizeWordTimestamps('один два три четыре пять шесть', 12, []);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startSec).toBeGreaterThanOrEqual(out[i - 1].endSec - 1e-6);
    }
  });
});
