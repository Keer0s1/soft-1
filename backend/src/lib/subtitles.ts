import fs from 'node:fs';
import path from 'node:path';

export interface SubtitleScene {
  text: string;
  startSec: number;
  endSec: number;
}

export interface SubtitleOpts {
  style: 'modern' | 'classic' | 'bold' | 'minimal';
  fontSize: number;
  position: 'bottom' | 'center' | 'top';
  x: number;
  y: number;
  resX: number;
  resY: number;
  color?: string;
  outline?: number;
  outlineColor?: string;
  shadow?: number;
  animation?: 'fade' | 'slideUp' | 'scale' | 'typewriter';
  bgEnabled?: boolean;
  bgColor?: string;
  bgOpacity?: number;
  spacing?: number;
}

const FONTS: Record<string, string> = {
  modern: 'Arial',
  classic: 'Times New Roman',
  bold: 'Impact',
  minimal: 'Arial',
};

const BOLD: Record<string, number> = { modern: -1, classic: 0, bold: -1, minimal: 0 };

function hexToASS(hex: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function hexToASSWithAlpha(hex: string, alpha: number): string {
  const a = Math.round((1 - alpha) * 255).toString(16).padStart(2, '0').toUpperCase();
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function buildAnimation(anim: string, durationMs: number): string {
  const fadeIn = Math.min(300, Math.round(durationMs * 0.1));
  const fadeOut = Math.min(200, Math.round(durationMs * 0.08));
  switch (anim) {
    case 'slideUp':
      return `\\move({x},{yEnd},{x},{y},0,${fadeIn})\\fad(${fadeIn},${fadeOut})`;
    case 'scale':
      return `\\fad(50,${fadeOut})\\t(0,${fadeIn},\\fscx100\\fscy100)`;
    case 'typewriter':
      return `\\fad(${fadeIn},${fadeOut})`;
    default:
      return `\\fad(${fadeIn},${fadeOut})`;
  }
}

export function generateASS(scenes: SubtitleScene[], opts: SubtitleOpts): string {
  const posX = Math.round((opts.x / 100) * opts.resX);
  const posY = Math.round((opts.y / 100) * opts.resY);
  const font = FONTS[opts.style] ?? 'Arial';
  const bold = BOLD[opts.style] ?? 0;
  const primaryColor = hexToASS(opts.color ?? '#FFFFFF');
  const outlineColor = hexToASS(opts.outlineColor ?? '#000000');
  const outlineSize = opts.outline ?? 3;
  const shadowSize = opts.shadow ?? 2;
  const borderStyle = opts.bgEnabled ? 3 : 1;
  const backColor = opts.bgEnabled
    ? hexToASSWithAlpha(opts.bgColor ?? '#000000', opts.bgOpacity ?? 0.5)
    : '&H64000000';

  const styleLine = `Style: Default,${font},${opts.fontSize},${primaryColor},&H000000FF,${outlineColor},${backColor},${bold},0,0,0,100,100,0,0,${borderStyle},${outlineSize},${shadowSize},5,30,30,40`;

  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${opts.resX}`,
    `PlayResY: ${opts.resY}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV',
    styleLine,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const anim = opts.animation ?? 'fade';

  for (const scene of scenes) {
    if (!scene.text.trim()) continue;
    const start = formatTime(scene.startSec);
    const end = formatTime(scene.endSec);
    const durationMs = (scene.endSec - scene.startSec) * 1000;
    const text = scene.text.replace(/\n/g, '\\N').replace(/\r/g, '');

    let animTag = buildAnimation(anim, durationMs);
    const yEnd = posY + 30;
    animTag = animTag.replace(/\{x\}/g, String(posX)).replace(/\{y\}/g, String(posY)).replace(/\{yEnd\}/g, String(yEnd));

    const scalePrefix = anim === 'scale' ? '\\fscx70\\fscy70' : '';
    lines.push(
      `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\an5\\pos(${posX},${posY})${scalePrefix}${animTag}}${text}`,
    );
  }

  return lines.join('\n') + '\n';
}

export function writeASS(scenes: SubtitleScene[], opts: SubtitleOpts, outDir: string): string {
  const content = generateASS(scenes, opts);
  const filePath = path.join(outDir, 'subtitles.ass');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// --- Word-level subtitles ---

export interface WordTimestamp {
  word: string;
  startSec: number;
  endSec: number;
}

/**
 * Группирует слова в фразы (по N слов или по паузе).
 * Это даёт CapCut-like субтитры: короткие фразы появляются и исчезают.
 */
function groupWordsIntoPhrases(words: WordTimestamp[], maxWords = 4, maxGapSec = 0.6): SubtitleScene[] {
  const phrases: SubtitleScene[] = [];
  let current: WordTimestamp[] = [];

  for (const w of words) {
    if (!w.word.trim()) continue;
    const gap = current.length > 0 ? w.startSec - current[current.length - 1].endSec : 0;
    if (current.length >= maxWords || (current.length > 0 && gap > maxGapSec)) {
      phrases.push({
        text: current.map((cw) => cw.word).join(' '),
        startSec: current[0].startSec,
        endSec: current[current.length - 1].endSec,
      });
      current = [];
    }
    current.push(w);
  }
  if (current.length > 0) {
    phrases.push({
      text: current.map((cw) => cw.word).join(' '),
      startSec: current[0].startSec,
      endSec: current[current.length - 1].endSec,
    });
  }
  return phrases;
}

/** Генерирует ASS с karaoke-подсветкой: фраза на экране, текущее слово ярче. */
export function generateKaraokeASS(words: WordTimestamp[], opts: SubtitleOpts): string {
  const posX = Math.round((opts.x / 100) * opts.resX);
  const posY = Math.round((opts.y / 100) * opts.resY);
  const font = FONTS[opts.style] ?? 'Arial';
  const bold = BOLD[opts.style] ?? 0;
  const primaryColor = hexToASS(opts.color ?? '#FFFFFF');
  const dimColor = hexToASSWithAlpha(opts.color ?? '#FFFFFF', 0.4);
  const outlineColor = hexToASS(opts.outlineColor ?? '#000000');
  const outlineSize = opts.outline ?? 3;
  const shadowSize = opts.shadow ?? 2;
  const borderStyle = opts.bgEnabled ? 3 : 1;
  const backColor = opts.bgEnabled
    ? hexToASSWithAlpha(opts.bgColor ?? '#000000', opts.bgOpacity ?? 0.5)
    : '&H64000000';

  const highlightColor = hexToASS('#FACC15');
  const sp = opts.spacing ?? 4;

  const lines: string[] = [
    '[Script Info]', 'ScriptType: v4.00+',
    `PlayResX: ${opts.resX}`, `PlayResY: ${opts.resY}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV',
    `Style: Default,${font},${opts.fontSize},${dimColor},&H000000FF,${outlineColor},${backColor},${bold},0,0,0,100,100,${sp},0,${borderStyle},${outlineSize},${shadowSize},5,30,30,40`,
    `Style: Highlight,${font},${Math.round(opts.fontSize * 1.05)},${highlightColor},&H000000FF,${outlineColor},${backColor},-1,0,0,0,100,100,${sp},0,${borderStyle},${outlineSize},${shadowSize},5,30,30,40`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  // Group into phrases
  const phrases = groupWordsIntoPhrases(words, 4, 0.6);
  let wordIdx = 0;

  for (const phrase of phrases) {
    const start = formatTime(phrase.startSec);
    const end = formatTime(phrase.endSec);
    // Build karaoke text: each word gets \kf timing, highlighted word uses override
    let text = `{\\an5\\pos(${posX},${posY})}`;
    const phraseWords: WordTimestamp[] = [];
    while (wordIdx < words.length && words[wordIdx].startSec < phrase.endSec) {
      if (words[wordIdx].word.trim()) phraseWords.push(words[wordIdx]);
      wordIdx++;
    }
    for (const pw of phraseWords) {
      const durCs = Math.round((pw.endSec - pw.startSec) * 100);
      text += `{\\kf${durCs}\\rHighlight}${pw.word} `;
    }
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text.trim()}`);
  }

  return lines.join('\n') + '\n';
}

export function generateWordASS(words: WordTimestamp[], opts: SubtitleOpts): string {
  // Use karaoke mode by default when word timestamps available
  return generateKaraokeASS(words, opts);
}

export function writeWordASS(words: WordTimestamp[], opts: SubtitleOpts, outDir: string): string {
  const content = generateWordASS(words, opts);
  const filePath = path.join(outDir, 'subtitles.ass');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// --- CTA Overlays ---

export interface CtaItem {
  text: string;
  emoji: string;
  timeSec: number;
  durationSec: number;
  x: number;
  y: number;
  scale: number;
  animation: string;
  style: string;
  color: string;
}

export function generateCtaASS(ctas: CtaItem[], resX: number, resY: number): string {
  const lines: string[] = [
    '[Script Info]', 'ScriptType: v4.00+',
    `PlayResX: ${resX}`, `PlayResY: ${resY}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV',
    `Style: CTA,Arial,38,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,3,2,0,5,20,20,20`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const cta of ctas) {
    const px = Math.round((cta.x / 100) * resX);
    const py = Math.round((cta.y / 100) * resY);
    const fontSize = Math.round(38 * cta.scale);
    const start = formatTime(cta.timeSec);
    const end = formatTime(cta.timeSec + cta.durationSec);
    const bgHex = cta.color.replace('#', '');
    const bgASS = `&H00${bgHex.slice(4,6)}${bgHex.slice(2,4)}${bgHex.slice(0,2)}`;

    let anim = '';
    const fadeMs = 250;
    if (cta.animation === 'fadeIn') anim = `\\fad(${fadeMs},${fadeMs})`;
    else if (cta.animation === 'bounce') anim = `\\fad(100,${fadeMs})\\t(0,200,\\fscx110\\fscy110)\\t(200,350,\\fscx100\\fscy100)`;
    else if (cta.animation === 'pulse') anim = `\\fad(${fadeMs},${fadeMs})\\t(0,500,\\fscx105\\fscy105)\\t(500,1000,\\fscx100\\fscy100)`;
    else anim = `\\fad(${fadeMs},${fadeMs})\\move(${px + 40},${py},${px},${py},0,300)`;

    const display = `${cta.emoji ? cta.emoji + ' ' : ''}${cta.text}`;
    lines.push(`Dialogue: 1,${start},${end},CTA,,0,0,0,,{\\an5\\pos(${px},${py})\\fs${fontSize}\\bord3\\3c${bgASS}\\shad0${anim}}${display}`);
  }

  return lines.join('\n') + '\n';
}

export function writeCtaASS(ctas: CtaItem[], resX: number, resY: number, outDir: string): string | null {
  if (!ctas.length) return null;
  const content = generateCtaASS(ctas, resX, resY);
  const filePath = path.join(outDir, 'cta.ass');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function writeOverlayASS(overlays: any[], resX: number, resY: number, outDir: string): string | null {
  if (!overlays.length) return null;
  const lines: string[] = [
    '[Script Info]', 'ScriptType: v4.00+',
    `PlayResX: ${resX}`, `PlayResY: ${resY}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV',
    `Style: OV,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,5,20,20,20`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const o of overlays) {
    const px = Math.round((o.x / 100) * resX);
    const py = Math.round((o.y / 100) * resY);
    const fontSize = Math.round(o.fontSize * o.scale);
    const start = formatTime(o.timeSec);
    const end = formatTime(o.timeSec + o.durationSec);
    const fc = (o.fontColor || '#FFFFFF').replace('#', '');
    const primaryASS = `&H00${fc.slice(4,6)}${fc.slice(2,4)}${fc.slice(0,2)}`;
    const oc = (o.outlineColor || '#000000').replace('#', '');
    const outlineASS = `&H00${oc.slice(4,6)}${oc.slice(2,4)}${oc.slice(0,2)}`;
    const inMs = Math.round((o.animInDur || 0.4) * 1000);
    const outMs = Math.round((o.animOutDur || 0.3) * 1000);

    let anim = `\\fad(${inMs},${outMs})`;
    if (o.animIn === 'slideLeft') anim = `\\move(${px - 60},${py},${px},${py},0,${inMs})\\fad(${inMs},${outMs})`;
    else if (o.animIn === 'slideRight') anim = `\\move(${px + 60},${py},${px},${py},0,${inMs})\\fad(${inMs},${outMs})`;
    else if (o.animIn === 'slideUp') anim = `\\move(${px},${py + 50},${px},${py},0,${inMs})\\fad(${inMs},${outMs})`;
    else if (o.animIn === 'slideDown') anim = `\\move(${px},${py - 50},${px},${py},0,${inMs})\\fad(${inMs},${outMs})`;
    else if (o.animIn === 'scaleUp' || o.animIn === 'bounce') anim = `\\fad(${inMs},${outMs})\\t(0,${inMs},\\fscx100\\fscy100)`;
    else if (o.animIn === 'rotateIn') anim = `\\fad(${inMs},${outMs})\\t(0,${inMs},\\frz0)`;

    const bold = o.fontWeight === 'bold' ? '\\b1' : '';
    const bgTag = o.bgEnabled ? `\\3c${outlineASS}\\bord${o.outlineWidth || 3}` : `\\bord${o.outlineWidth || 0}`;
    const tags = `{\\an5\\pos(${px},${py})\\fs${fontSize}\\fn${o.fontFamily || 'Arial'}\\1c${primaryASS}\\3c${outlineASS}${bgTag}\\shad${o.shadowSize || 0}${bold}${anim}}`;
    lines.push(`Dialogue: 2,${start},${end},OV,,0,0,0,,${tags}${o.text}`);
  }

  const filePath = path.join(outDir, 'overlays.ass');
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  return filePath;
}
