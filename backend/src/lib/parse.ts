// Разбор сценария на сцены (текст озвучки + промт картинки).
// Используется, когда сцены вставляют одним текстом, а не строят в редакторе вручную.

export interface ParsedScene {
  voiceText: string;
  imagePrompt: string;
}

export class ParseError extends Error {}

/**
 * Вариант 1 — один файл с маркерами: после куска текста строка `IMG: промт`
 *   (также ИЗО:/КАРТИНКА:).
 * Вариант 2 — два текста: сценарий разбит пустыми строками на абзацы,
 *   промты — по одному на строку (абзац N -> промт N).
 */
export function parseScript(scriptText: string, promptsText?: string): ParsedScene[] {
  if (promptsText && promptsText.trim()) {
    const paragraphs = scriptText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const prompts = promptsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (paragraphs.length !== prompts.length) {
      throw new ParseError(
        `Число абзацев сценария (${paragraphs.length}) не совпадает с числом промтов ` +
          `(${prompts.length}). Абзацы разделяются пустой строкой, промты — по одному на строку.`,
      );
    }
    return paragraphs.map((p, i) => ({ voiceText: p, imagePrompt: prompts[i] }));
  }

  const scenes: ParsedScene[] = [];
  let buf: string[] = [];
  const markerRe = /^\s*(?:IMG|ИЗО|КАРТИНКА)\s*:\s*(.+)$/i;
  for (const line of scriptText.split(/\r?\n/)) {
    const m = markerRe.exec(line);
    if (m) {
      const text = buf.join('\n').trim();
      if (!text) throw new ParseError('Найден промт IMG: без текста сцены перед ним.');
      scenes.push({ voiceText: text, imagePrompt: m[1].trim() });
      buf = [];
    } else {
      buf.push(line);
    }
  }
  const leftover = buf.join('\n').trim();
  if (leftover) {
    if (scenes.length) scenes[scenes.length - 1].voiceText += '\n' + leftover;
    else
      throw new ParseError(
        'В сценарии нет промтов картинок. Добавь после каждого куска текста строку `IMG: промт`, ' +
          'либо передай отдельный список промтов (по одному на строку).',
      );
  }
  if (!scenes.length) throw new ParseError('Сценарий пустой.');
  return scenes;
}
