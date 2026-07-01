import { describe, it, expect } from 'vitest';
import { parseTwoFiles, ParseError, compressLines, expandLines, splitInHalfByWord, splitIntoParts } from '../src/lib/parse.js';

describe('parseTwoFiles', () => {
  it('разбирает одинаковое число строк', () => {
    const result = parseTwoFiles(
      'Привет мир\nВторая сцена',
      'hello world scene\nsecond scene image',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ voiceText: 'Привет мир', imagePrompt: 'hello world scene' });
    expect(result[1]).toEqual({ voiceText: 'Вторая сцена', imagePrompt: 'second scene image' });
  });

  it('игнорирует пустые строки', () => {
    const result = parseTwoFiles(
      'Первая\n\n\nВторая\n',
      'prompt1\n\nprompt2',
    );
    expect(result).toHaveLength(2);
  });

  it('выбрасывает ParseError при пустом файле речи', () => {
    expect(() => parseTwoFiles('', 'prompt')).toThrow(ParseError);
  });

  it('выбрасывает ParseError при пустом файле промтов', () => {
    expect(() => parseTwoFiles('текст', '')).toThrow(ParseError);
  });

  it('выбрасывает ParseError при несовпадении количества', () => {
    expect(() => parseTwoFiles('раз\nдва\nтри', 'p1\np2')).toThrow(ParseError);
    expect(() => parseTwoFiles('раз\nдва\nтри', 'p1\np2')).toThrow(/не совпадает/i);
  });

  it('тримит строки', () => {
    const result = parseTwoFiles('  hello  ', '  prompt  ');
    expect(result[0].voiceText).toBe('hello');
    expect(result[0].imagePrompt).toBe('prompt');
  });
});

describe('splitInHalfByWord', () => {
  it('делит чётное число слов ровно пополам', () => {
    expect(splitInHalfByWord('один два три четыре')).toEqual(['один два', 'три четыре']);
  });

  it('делит нечётное число слов: правая длиннее', () => {
    const [l, r] = splitInHalfByWord('а б в г д');
    expect(l.split(' ')).toHaveLength(3);
    expect(r.split(' ')).toHaveLength(2);
  });

  it('одно слово — делит по символам', () => {
    expect(splitInHalfByWord('кошка')).toEqual(['кош', 'ка']);
  });
});

describe('compressLines (большая история)', () => {
  it('возвращает копию, если длина совпадает', () => {
    const r = compressLines(['a', 'b', 'c'], 3);
    expect(r).toEqual(['a', 'b', 'c']);
  });

  it('пример пользователя: 15 → 10, порядок сохранён, слова не теряются', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `строка${i + 1} слово`);
    const out = compressLines(lines, 10);
    expect(out).toHaveLength(10);
    // Все исходные «строкаN» должны где-то остаться (склейка не теряет слова).
    const joined = out.join(' ');
    for (let i = 1; i <= 15; i++) {
      expect(joined).toContain(`строка${i}`);
    }
  });

  it('порядок сохраняется: ни одна левая «строкаN» не появляется правее правой «строкаM», N<M', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `S${i + 1} word`);
    const out = compressLines(lines, 12);
    // Найдём позиции первых вхождений S1..S20 в склеенном тексте.
    const positions = [];
    let scanFrom = 0;
    const flat = out.join('\n');
    for (let i = 1; i <= 20; i++) {
      const pos = flat.indexOf(`S${i}`, scanFrom);
      expect(pos).toBeGreaterThanOrEqual(0); // не потерялась
      expect(pos).toBeGreaterThanOrEqual(scanFrom);
      scanFrom = pos;
      positions.push(pos);
    }
    // Дополнительно: позиции монотонно неубывают.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
  });

  it('две лишних подряд — обе растворяются корректно', () => {
    const lines = ['A', 'B', 'C', 'D', 'E', 'F'];
    const out = compressLines(lines, 4);
    expect(out).toHaveLength(4);
    // Все буквы должны остаться, в том же порядке.
    const joined = out.join('|');
    const order = ['A', 'B', 'C', 'D', 'E', 'F']
      .map((ch) => joined.indexOf(ch))
      .filter((p) => p >= 0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order).toHaveLength(6);
  });

  it('строк меньше target — кидает ошибку', () => {
    expect(() => compressLines(['a', 'b'], 5)).toThrow(ParseError);
  });
});

describe('parseTwoFiles с bigStory', () => {
  it('склеивает лишние строки речи под количество промтов', () => {
    // Дадим многословные строки — тогда split идёт по словам и каждая строка
    // остаётся целиком в одном из соседей.
    const speech = Array.from({ length: 15 }, (_, i) => `строка${i + 1} слово`).join('\n');
    const prompts = Array.from({ length: 10 }, (_, i) => `p${i + 1}`).join('\n');
    const r = parseTwoFiles(speech, prompts, { bigStory: true });
    expect(r).toHaveLength(10);
    expect(r[0].imagePrompt).toBe('p1');
    expect(r[9].imagePrompt).toBe('p10');
    const joined = r.map((s) => s.voiceText).join(' ');
    for (let i = 1; i <= 15; i++) expect(joined).toContain(`строка${i}`);
  });

  it('режет строки сценария, если их меньше чем промтов', () => {
    // 3 длинных строки → 5 сцен (нужно 2 дополнительных разреза).
    const speech = [
      'один два три четыре пять шесть семь восемь',
      'девять десять одиннадцать двенадцать тринадцать четырнадцать',
      'пятнадцать шестнадцать семнадцать восемнадцать девятнадцать двадцать',
    ].join('\n');
    const prompts = Array.from({ length: 5 }, (_, i) => `p${i + 1}`).join('\n');
    const r = parseTwoFiles(speech, prompts, { bigStory: true });
    expect(r).toHaveLength(5);
    expect(r[0].imagePrompt).toBe('p1');
    expect(r[4].imagePrompt).toBe('p5');
    // Все 20 слов должны где-то остаться в порядке.
    const all = r.map((s) => s.voiceText).join(' ');
    const words = ['один', 'два', 'двадцать', 'десять'];
    for (const w of words) expect(all).toContain(w);
  });

  it('одинаковое количество — работает как обычный режим', () => {
    const r = parseTwoFiles('a\nb\nc', 'p1\np2\np3', { bigStory: true });
    expect(r.map((s) => s.voiceText)).toEqual(['a', 'b', 'c']);
  });
});

describe('splitIntoParts', () => {
  it('1 кусок — без изменений', () => {
    expect(splitIntoParts('один два три', 1)).toEqual(['один два три']);
  });

  it('режет 6 слов на 3 куска по 2 слова', () => {
    expect(splitIntoParts('один два три четыре пять шесть', 3))
      .toEqual(['один два', 'три четыре', 'пять шесть']);
  });

  it('слов меньше чем нужно кусков — режет по одному слову', () => {
    const r = splitIntoParts('один два три', 5);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.join(' ').split(/\s+/).filter(Boolean)).toHaveLength(3);
  });

  it('одно слово — режет по символам если nParts > 1', () => {
    const r = splitIntoParts('кошка', 2);
    expect(r).toHaveLength(2);
    expect(r.join('')).toBe('кошка');
  });
});

describe('expandLines (большая история — растягивание)', () => {
  it('возвращает копию, если длина совпадает', () => {
    expect(expandLines(['a', 'b'], 2)).toEqual(['a', 'b']);
  });

  it('растягивает 3 многословных строки до 6 кусков', () => {
    const lines = [
      'один два три четыре',
      'пять шесть семь восемь девять десять',
      'одиннадцать двенадцать тринадцать четырнадцать',
    ];
    const out = expandLines(lines, 6);
    expect(out).toHaveLength(6);
    // Все слова сохранились в порядке
    const flat = out.join(' ').split(/\s+/);
    const expected = ['один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь',
      'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать'];
    expect(flat).toEqual(expected);
  });

  it('300 строк → 400 сцен (реалистичный случай пользователя)', () => {
    const lines = Array.from({ length: 300 }, (_, i) =>
      `сцена${i + 1} длинная фраза с несколькими словами здесь много текста`);
    const out = expandLines(lines, 400);
    expect(out).toHaveLength(400);
    // Все 300 маркеров сохранились и в правильном порядке.
    const flat = out.join(' ');
    let last = -1;
    for (let i = 1; i <= 300; i++) {
      const pos = flat.indexOf(`сцена${i}`);
      expect(pos).toBeGreaterThan(last);
      last = pos;
    }
  });

  it('бросает понятную ошибку если строк больше чем target', () => {
    expect(() => expandLines(['a', 'b', 'c'], 1)).toThrow(/нечего разрезать/i);
  });
});
