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
 * @param options.bigStory режим «большая история»: количество строк сценария
 *   и промтов может не совпадать. Главное — число ПРОМТОВ (= число сцен).
 *   Если строк сценария больше — лишние режутся пополам и приклеиваются
 *   к соседям. Если меньше — самые длинные строки делятся на несколько
 *   кусков, чтобы заполнить недостающие сцены. Порядок никогда не меняется.
 */
export function parseTwoFiles(
  speechText: string,
  promptsText: string,
  options: { bigStory?: boolean } = {},
): ParsedScene[] {
  let speeches = nonEmptyLines(speechText);
  const prompts = nonEmptyLines(promptsText);

  if (speeches.length === 0) throw new ParseError('Файл речи пустой.');
  if (prompts.length === 0) throw new ParseError('Файл промтов пустой.');

  if (speeches.length === prompts.length) {
    return speeches.map((voiceText, i) => ({ voiceText, imagePrompt: prompts[i] }));
  }

  if (options.bigStory) {
    if (speeches.length > prompts.length) {
      speeches = compressLines(speeches, prompts.length);
    } else {
      speeches = expandLines(speeches, prompts.length);
    }
    return speeches.map((voiceText, i) => ({ voiceText, imagePrompt: prompts[i] }));
  }

  const diverge = Math.min(speeches.length, prompts.length) + 1;
  throw new ParseError(
    `Не совпадает количество: строк речи ${speeches.length}, промтов ${prompts.length}. ` +
      `Разъехалось примерно на строке ${diverge}. Проверь, что у каждой сцены есть свой промт. ` +
      `Если делаешь длинную историю, где видеоряд не привязан к словам, включи режим «Большая история».`,
  );
}

/**
 * Сжимает массив строк с lines.length до target. Лишние строки выбираются
 * равномерно по позиции (вариант «Б» — не «короткие»), затем растворяются:
 * каждая делится пополам на границе слова, левая половина приклеивается
 * к предыдущей строке, правая — к следующей. Сама строка пропадает.
 *
 * Порядок строк никогда не меняется — что шло сначала, идёт сначала.
 * Жертвы предпочитаем брать ВНУТРИ (1..len-2), чтобы не было краевых
 * случаев. Если жертв так много, что без краёв не уместить — берём и края.
 */
export function compressLines(lines: string[], target: number): string[] {
  if (target <= 0) throw new ParseError('Целевая длина должна быть > 0.');
  if (lines.length === target) return [...lines];
  if (lines.length < target) {
    throw new ParseError(`Строк ${lines.length}, нужно ${target} — нечего сжимать.`);
  }
  const toRemove = lines.length - target;
  if (toRemove >= lines.length) {
    throw new ParseError(`Слишком сильное сжатие: ${lines.length} → ${target}.`);
  }

  const victims = pickVictims(lines.length, toRemove);
  const arr = [...lines];

  // Идём справа налево: удаление по индексу справа не сбивает левые индексы.
  for (let k = victims.length - 1; k >= 0; k--) {
    const i = victims[k];
    const text = arr[i];
    const [left, right] = splitInHalfByWord(text);
    const lastIdx = arr.length - 1;

    if (i > 0 && i < lastIdx) {
      arr[i - 1] = joinChunks(arr[i - 1], left);
      arr[i + 1] = joinChunks(right, arr[i + 1]);
    } else if (i === 0) {
      // Краевой: вся целиком к следующей (порядок сохраняем — она перед ней)
      arr[i + 1] = joinChunks(text, arr[i + 1]);
    } else {
      // i === lastIdx: вся к предыдущей
      arr[i - 1] = joinChunks(arr[i - 1], text);
    }
    arr.splice(i, 1);
  }

  return arr;
}

/**
 * Выбирает k индексов из [0, n) равномерно. По возможности избегает краёв
 * (0 и n-1), чтобы сохранить начало и конец истории целыми; если без краёв
 * не уместить — расширяет диапазон. Возвращает отсортированный массив.
 */
function pickVictims(n: number, k: number): number[] {
  if (k <= 0) return [];
  if (k >= n) {
    return Array.from({ length: n }, (_, i) => i);
  }

  // Сначала пробуем выбрать из внутреннего диапазона [1, n-2].
  // Внутри n-2 позиций; если k <= n-2 — поместятся.
  let lo = 1;
  let hi = n - 2;
  if (k > hi - lo + 1) {
    // Не помещаемся внутрь — расширяем на края.
    lo = 0;
    hi = n - 1;
  }

  const span = hi - lo + 1;
  // Равномерно: i-я жертва на позиции lo + round((i + 0.5) * span / k).
  const picks = new Set<number>();
  for (let i = 0; i < k; i++) {
    const raw = lo + Math.floor(((i + 0.5) * span) / k);
    let pos = Math.min(hi, Math.max(lo, raw));
    // Если позиция уже занята (бывает при k близком к span), сдвигаем вправо,
    // потом влево — лишь бы не дублировать.
    while (picks.has(pos) && pos < hi) pos++;
    while (picks.has(pos) && pos > lo) pos--;
    picks.add(pos);
  }
  return [...picks].sort((a, b) => a - b);
}

/** Делит строку пополам на ближайшей границе слова. Левая, правая. */
export function splitInHalfByWord(text: string): [string, string] {
  const t = text.trim();
  if (!t) return ['', ''];
  const words = t.split(/\s+/);
  if (words.length === 1) {
    // Одно слово — делим пополам по символам.
    const mid = Math.ceil(t.length / 2);
    return [t.slice(0, mid), t.slice(mid)];
  }
  const mid = Math.round(words.length / 2);
  const left = words.slice(0, mid).join(' ');
  const right = words.slice(mid).join(' ');
  return [left, right];
}

/** Склеивает два куска текста через пробел, без дублей пробелов. */
function joinChunks(a: string, b: string): string {
  const left = (a ?? '').trimEnd();
  const right = (b ?? '').trimStart();
  if (!left) return right;
  if (!right) return left;
  // Если слева есть знак препинания в конце — оставляем пробел; иначе тоже пробел.
  return `${left} ${right}`;
}

/**
 * Растягивает массив строк с lines.length до target. Самые длинные строки
 * режутся на несколько кусков пропорционально длине, чтобы получить N кусков
 * на выходе. Порядок сохраняется — кусок K строки идёт перед куском K+1.
 *
 * Алгоритм:
 *   1) Распределяем нужное число дополнительных кусков по строкам по их длине
 *      в словах (метод Хантингтона-Хилла / largest remainder). Каждая строка
 *      получает >=1 кусок (минимум одна сцена на строку).
 *   2) Каждую строку режем на отведённое число кусков ~равной длины по словам.
 */
export function expandLines(lines: string[], target: number): string[] {
  if (target <= 0) throw new ParseError('Целевая длина должна быть > 0.');
  if (lines.length === target) return [...lines];
  if (lines.length > target) {
    throw new ParseError(`Строк ${lines.length}, нужно ${target} — нечего разрезать.`);
  }
  if (lines.length === 0) {
    throw new ParseError('Нет строк для разрезания.');
  }

  const partsPerLine = allocateParts(lines, target);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const pieces = splitIntoParts(lines[i], partsPerLine[i]);
    for (const p of pieces) out.push(p);
  }
  // Корректировка: из-за вырожденных случаев (строки из 1 слова) реальное
  // число кусков может оказаться меньше target. Тогда добиваем — режем
  // самую длинную из получившихся кусков ещё на 2, пока не наберём target.
  while (out.length < target) {
    let longestIdx = 0;
    let longestLen = -1;
    for (let i = 0; i < out.length; i++) {
      const wc = out[i].trim().split(/\s+/).filter(Boolean).length;
      if (wc > longestLen) { longestLen = wc; longestIdx = i; }
    }
    if (longestLen < 2 && out[longestIdx].length < 4) break; // некуда дальше
    const [l, r] = splitInHalfByWord(out[longestIdx]);
    if (!l || !r) break;
    out.splice(longestIdx, 1, l, r);
  }
  if (out.length !== target) {
    throw new ParseError(
      `Не удалось разрезать сценарий на ${target} частей (получилось ${out.length}). ` +
        `Дай побольше текста — слишком короткие строки нечем делить.`,
    );
  }
  return out;
}

/**
 * Распределяет target кусков по строкам пропорционально длине (в словах),
 * минимум 1 кусок на строку. Метод largest-remainder.
 */
function allocateParts(lines: string[], target: number): number[] {
  const n = lines.length;
  const weights = lines.map((l) => Math.max(l.trim().split(/\s+/).filter(Boolean).length, 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const extra = target - n;
  if (extra <= 0) return new Array(n).fill(1);

  // Идеальная доля каждой строки в «extra» дополнительных кусках.
  const ideal = weights.map((w) => (w / totalWeight) * extra);
  const base = ideal.map((x) => Math.floor(x));
  let used = base.reduce((a, b) => a + b, 0);
  const remainders = ideal.map((x, i) => ({ i, rem: x - Math.floor(x) }));
  remainders.sort((a, b) => b.rem - a.rem);
  let r = 0;
  while (used < extra) {
    base[remainders[r % n].i]++;
    used++;
    r++;
  }
  return base.map((b) => b + 1);
}

/**
 * Режет одну строку на nParts ~равных кусков по словам. Если слов меньше
 * чем nParts, режет столько раз сколько может (минимум 1 кусок).
 * При одном слове на input возвращает [text] (одно слово неделимо словами).
 */
export function splitIntoParts(text: string, nParts: number): string[] {
  if (nParts <= 1) return [text];
  const t = text.trim();
  if (!t) return [''];
  const words = t.split(/\s+/);
  if (words.length === 1) {
    // Одно слово — разрежем по символам на nParts (или 1, если слово короткое)
    const parts = Math.min(nParts, Math.max(1, Math.floor(t.length / 2)));
    if (parts <= 1) return [t];
    const out: string[] = [];
    const step = t.length / parts;
    for (let i = 0; i < parts; i++) {
      const a = Math.round(i * step);
      const b = Math.round((i + 1) * step);
      out.push(t.slice(a, b));
    }
    return out.filter(Boolean);
  }
  // Если слов меньше, чем нужных кусков — режем по одному слову на кусок
  // (хвостовые останутся короче). Итог: получим min(nParts, words.length) кусков.
  const parts = Math.min(nParts, words.length);
  const out: string[] = [];
  const step = words.length / parts;
  for (let i = 0; i < parts; i++) {
    const a = Math.floor(i * step);
    const b = i === parts - 1 ? words.length : Math.floor((i + 1) * step);
    out.push(words.slice(a, b).join(' '));
  }
  return out;
}
