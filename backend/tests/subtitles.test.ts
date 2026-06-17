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

  it('генерирует Dialogue для каждой сцены', () => {
    const ass = generateASS(scenes, { style: 'modern', fontSize: 48, position: 'bottom', x: 50, y: 85, resX: 1920, resY: 1080 });
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
});
