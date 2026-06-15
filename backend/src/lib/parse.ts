// Разбор сценария на сцены: матчинг ДВУХ файлов построчно.
// Речь: каждая непустая строка = сцена. Промты: каждая непустая строка = промт.
// Пустые строки игнорируются (можно разделять и пустой строкой, и подряд).
// Сцена N = строка N речи + строка N промта.

export interface ParsedScene {
  voiceText: string;
  imagePrompt: string;
}

export class ParseError extends Error {}

const nonEmptyLines = (text: string): string[] =>
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/**
 * Матчинг двух файлов по строкам.
 * @param speechText файл речи (строка = сцена)
 * @param promptsText файл промтов (строка = промт)
 */
export function parseTwoFiles(speechText: string, promptsText: string): ParsedScene[] {
  const speeches = nonEmptyLines(speechText);
  const prompts = nonEmptyLines(promptsText);

  if (speeches.length === 0) throw new ParseError('Файл речи пустой.');
  if (prompts.length === 0) throw new ParseError('Файл промтов пустой.');

  if (speeches.length !== prompts.length) {
    const diverge = Math.min(speeches.length, prompts.length) + 1;
    throw new ParseError(
      `Не совпадает количество: строк речи ${speeches.length}, промтов ${prompts.length}. ` +
        `Разъехалось примерно на строке ${diverge}. Проверь, что у каждой сцены есть свой промт.`,
    );
  }

  return speeches.map((voiceText, i) => ({ voiceText, imagePrompt: prompts[i] }));
}
