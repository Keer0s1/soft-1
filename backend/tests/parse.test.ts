import { describe, it, expect } from 'vitest';
import { parseTwoFiles, ParseError } from '../src/lib/parse.js';

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
