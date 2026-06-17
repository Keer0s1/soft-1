import crypto from 'node:crypto';

export interface ClipHashInput {
  imagePath: string;
  durationSec: number;
  zoomPreset: string | null;
  zoomIntensity: number;
  zoomSpeed: number;
  zoomEasing: string;
  zoomFocusX: number;
  zoomFocusY: number;
  zoomShake: number;
  width: number;
  height: number;
  fps: number;
  quality: string;
}

export function computeClipHash(input: ClipHashInput): string {
  const data = [
    input.imagePath,
    input.durationSec.toFixed(3),
    input.zoomPreset ?? 'none',
    input.zoomIntensity.toFixed(4),
    input.zoomSpeed.toFixed(2),
    input.zoomEasing,
    input.zoomFocusX.toFixed(1),
    input.zoomFocusY.toFixed(1),
    input.zoomShake.toFixed(2),
    `${input.width}x${input.height}`,
    String(input.fps),
    input.quality,
  ].join('|');
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
}
