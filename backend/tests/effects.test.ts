import { describe, it, expect } from 'vitest';
import { buildZoomFilter, staticFilter, pickSequence, validZoomPresets, validTransitionPresets, resolveEffects } from '../src/lib/effects.js';
import { computeClipHash } from '../src/lib/hash.js';

describe('effects', () => {
  describe('buildZoomFilter', () => {
    it('возвращает строку с zoompan', () => {
      const vf = buildZoomFilter('in', 120, 0.15, 1920, 1080, 24);
      expect(vf).toContain('zoompan');
      expect(vf).toContain('1920x1080');
      expect(vf).toContain('d=120');
    });

    it('обрабатывает все пресеты без ошибок', () => {
      const presets = ['in', 'out', 'left', 'right', 'up', 'down', 'inUp', 'inDown'];
      for (const p of presets) {
        const vf = buildZoomFilter(p, 60, 0.2, 1920, 1080, 24);
        expect(vf).toContain('zoompan');
      }
    });

    it('неизвестный пресет работает как zoom in (default)', () => {
      const vf = buildZoomFilter('unknown', 60, 0.1, 1920, 1080, 24);
      expect(vf).toContain('zoompan');
    });
  });

  describe('staticFilter', () => {
    it('масштабирует и кропает', () => {
      const vf = staticFilter(1920, 1080);
      expect(vf).toContain('scale=1920:1080');
      expect(vf).toContain('crop=1920:1080');
    });
  });

  describe('pickSequence', () => {
    it('возвращает нужное количество элементов', () => {
      const result = pickSequence(['a', 'b', 'c'], 5);
      expect(result).toHaveLength(5);
    });

    it('возвращает пустой массив при пустом пуле', () => {
      expect(pickSequence([], 3)).toEqual([]);
    });

    it('не ставит одинаковые подряд при пуле > 1', () => {
      const result = pickSequence(['a', 'b'], 20);
      for (let i = 1; i < result.length; i++) {
        expect(result[i]).not.toBe(result[i - 1]);
      }
    });
  });

  describe('validZoomPresets', () => {
    it('фильтрует валидные пресеты', () => {
      expect(validZoomPresets(['in', 'garbage', 'out'])).toEqual(['in', 'out']);
    });

    it('возвращает fallback при пустом массиве', () => {
      expect(validZoomPresets([])).toEqual(['in']);
    });

    it('возвращает fallback при невалидном входе', () => {
      expect(validZoomPresets(null)).toEqual(['in']);
      expect(validZoomPresets('string')).toEqual(['in']);
    });
  });

  describe('validTransitionPresets', () => {
    it('фильтрует валидные пресеты', () => {
      expect(validTransitionPresets(['fade', 'xxx', 'dissolve'])).toEqual(['fade', 'dissolve']);
    });

    it('возвращает fallback при невалидном входе', () => {
      expect(validTransitionPresets(undefined)).toEqual(['fade']);
    });
  });

  describe('buildZoomFilter — расширенные параметры', () => {
    it('применяет focusX/focusY (не центр)', () => {
      const vf = buildZoomFilter('in', 60, 0.2, 1920, 1080, 24, 1.0, 'linear', 25, 75);
      expect(vf).toContain('0.2500'); // focusX/100
      expect(vf).toContain('0.7500'); // focusY/100
    });

    it('применяет easing easeIn (квадратичная функция)', () => {
      const linear = buildZoomFilter('in', 100, 0.2, 1920, 1080, 24, 1.0, 'linear', 50, 50);
      const easeIn = buildZoomFilter('in', 100, 0.2, 1920, 1080, 24, 1.0, 'easeIn', 50, 50);
      expect(linear).not.toBe(easeIn);
      expect(easeIn).toContain('*'); // квадратичная подстановка
    });

    it('speed > 1 укорачивает анимацию (effective n меньше)', () => {
      const slow = buildZoomFilter('in', 120, 0.2, 1920, 1080, 24, 1.0, 'linear');
      const fast = buildZoomFilter('in', 120, 0.2, 1920, 1080, 24, 2.0, 'linear');
      expect(slow).not.toBe(fast);
    });

    it('shake=0 не добавляет дрожание', () => {
      const vf = buildZoomFilter('in', 60, 0.2, 1920, 1080, 24, 1.0, 'linear', 50, 50, 0);
      expect(vf).not.toContain('sin(');
    });

    it('shake>0 добавляет sin/cos выражения к x/y', () => {
      const vf = buildZoomFilter('in', 60, 0.2, 1920, 1080, 24, 1.0, 'linear', 50, 50, 5);
      expect(vf).toContain('sin(');
      expect(vf).toContain('cos(');
    });
  });

  describe('resolveEffects', () => {
    const baseProject = {
      zoomEnabled: true,
      zoomIntensity: 0.15,
      zoomSpeed: 1.0,
      zoomEasing: 'linear',
      cameraShake: 0,
      zoomPresets: ['in', 'out'],
      transitionEnabled: true,
      transitionDuration: 0.5,
      transitionPresets: ['fade'],
    };

    it('возвращает все массивы нужной длины', () => {
      const r = resolveEffects([{ effectOverrides: null }, { effectOverrides: null }, { effectOverrides: null }], baseProject, 'p1');
      expect(r.zoomSeq).toHaveLength(3);
      expect(r.zoomIntensities).toHaveLength(3);
      expect(r.zoomSpeeds).toHaveLength(3);
      expect(r.zoomEasings).toHaveLength(3);
      expect(r.zoomFocusX).toHaveLength(3);
      expect(r.zoomFocusY).toHaveLength(3);
      expect(r.zoomShakes).toHaveLength(3);
      expect(r.transSeq).toHaveLength(2); // n-1
    });

    it('per-scene overrides приоритетнее project defaults', () => {
      const r = resolveEffects([
        { effectOverrides: { zoomIntensity: 0.3, speed: 1.5, easing: 'easeIn', focusX: 25, focusY: 75, cameraShake: 8 } },
      ], baseProject, 'p1');
      expect(r.zoomIntensities[0]).toBe(0.3);
      expect(r.zoomSpeeds[0]).toBe(1.5);
      expect(r.zoomEasings[0]).toBe('easeIn');
      expect(r.zoomFocusX[0]).toBe(25);
      expect(r.zoomFocusY[0]).toBe(75);
      expect(r.zoomShakes[0]).toBe(8);
    });

    it('fallback на project defaults когда override отсутствует', () => {
      const r = resolveEffects([{ effectOverrides: null }], { ...baseProject, zoomSpeed: 1.7, cameraShake: 3 }, 'p1');
      expect(r.zoomSpeeds[0]).toBe(1.7);
      expect(r.zoomShakes[0]).toBe(3);
    });

    it('disableZoom => zoomSeq[i] = null', () => {
      const r = resolveEffects([{ effectOverrides: { disableZoom: true } }], baseProject, 'p1');
      expect(r.zoomSeq[0]).toBeNull();
    });

    it('disableTransition на сцене => transSeq[i] = null', () => {
      const r = resolveEffects([
        { effectOverrides: { disableTransition: true } },
        { effectOverrides: null },
      ], baseProject, 'p1');
      expect(r.transSeq[0]).toBeNull();
    });

    it('детерминированный seed: одинаковые projectId => одинаковые последовательности', () => {
      const a = resolveEffects([{ effectOverrides: null }, { effectOverrides: null }], baseProject, 'fixed-seed');
      const b = resolveEffects([{ effectOverrides: null }, { effectOverrides: null }], baseProject, 'fixed-seed');
      expect(a.zoomSeq).toEqual(b.zoomSeq);
      expect(a.transSeq).toEqual(b.transSeq);
    });
  });

  describe('computeClipHash', () => {
    const base = {
      imagePath: '/img.png', durationSec: 4.5, zoomPreset: 'in' as string | null,
      zoomIntensity: 0.2, zoomSpeed: 1.0, zoomEasing: 'linear',
      zoomFocusX: 50, zoomFocusY: 50, zoomShake: 0,
      width: 1920, height: 1080, fps: 24, quality: 'balance',
    };

    it('одинаковые входы дают одинаковый хеш', () => {
      expect(computeClipHash(base)).toBe(computeClipHash(base));
    });

    it('разные speed дают разные хеши', () => {
      expect(computeClipHash(base)).not.toBe(computeClipHash({ ...base, zoomSpeed: 1.5 }));
    });

    it('разные easing дают разные хеши', () => {
      expect(computeClipHash(base)).not.toBe(computeClipHash({ ...base, zoomEasing: 'easeIn' }));
    });

    it('разные focus дают разные хеши', () => {
      expect(computeClipHash(base)).not.toBe(computeClipHash({ ...base, zoomFocusX: 25 }));
      expect(computeClipHash(base)).not.toBe(computeClipHash({ ...base, zoomFocusY: 75 }));
    });

    it('разные shake дают разные хеши', () => {
      expect(computeClipHash(base)).not.toBe(computeClipHash({ ...base, zoomShake: 5 }));
    });

    it('разное качество дает разные хеши (preview vs final)', () => {
      expect(computeClipHash(base)).not.toBe(computeClipHash({ ...base, quality: 'preview' }));
    });
  });
});
