import { describe, it, expect } from 'vitest';
import { createProjectSchema, updateProjectSchema, replaceScenesSchema, updateSceneSchema, effectOverridesSchema } from '../src/schemas.js';

describe('schemas', () => {
  describe('createProjectSchema', () => {
    it('принимает пустой объект', () => {
      expect(createProjectSchema.parse({})).toEqual({});
    });

    it('принимает title', () => {
      expect(createProjectSchema.parse({ title: 'Мой ролик' }).title).toBe('Мой ролик');
    });

    it('отвергает слишком длинный title', () => {
      expect(() => createProjectSchema.parse({ title: 'x'.repeat(201) })).toThrow();
    });
  });

  describe('updateProjectSchema', () => {
    it('принимает provider', () => {
      const r = updateProjectSchema.parse({ provider: 'flower' });
      expect(r.provider).toBe('flower');
    });

    it('отвергает невалидный provider', () => {
      expect(() => updateProjectSchema.parse({ provider: 'invalid' })).toThrow();
    });

    it('принимает aspectRatio', () => {
      const r = updateProjectSchema.parse({ aspectRatio: '9:16' });
      expect(r.aspectRatio).toBe('9:16');
    });

    it('отвергает невалидный aspectRatio', () => {
      expect(() => updateProjectSchema.parse({ aspectRatio: '2:1' })).toThrow();
    });

    it('валидирует zoomIntensity диапазон', () => {
      expect(() => updateProjectSchema.parse({ zoomIntensity: -1 })).toThrow();
      expect(() => updateProjectSchema.parse({ zoomIntensity: 0.6 })).toThrow();
      expect(updateProjectSchema.parse({ zoomIntensity: 0.2 }).zoomIntensity).toBe(0.2);
    });

    it('принимает renderQuality', () => {
      expect(updateProjectSchema.parse({ renderQuality: 'quality' }).renderQuality).toBe('quality');
    });

    it('отвергает невалидный renderQuality', () => {
      expect(() => updateProjectSchema.parse({ renderQuality: 'ultra' })).toThrow();
    });
  });

  describe('replaceScenesSchema', () => {
    it('принимает массив сцен', () => {
      const r = replaceScenesSchema.parse({ scenes: [{ voiceText: 'hi', imagePrompt: 'p' }] });
      expect(r.scenes).toHaveLength(1);
    });

    it('отвергает пустой массив', () => {
      expect(() => replaceScenesSchema.parse({ scenes: [] })).toThrow();
    });
  });

  describe('updateSceneSchema', () => {
    it('принимает частичное обновление', () => {
      const r = updateSceneSchema.parse({ voiceText: 'новый текст' });
      expect(r.voiceText).toBe('новый текст');
      expect(r.imagePrompt).toBeUndefined();
    });
  });

  describe('effectOverridesSchema — новые поля', () => {
    it('принимает speed/easing/focus/shake', () => {
      const r = effectOverridesSchema.parse({ speed: 1.5, easing: 'easeIn', focusX: 25, focusY: 75, cameraShake: 5 });
      expect(r?.speed).toBe(1.5);
      expect(r?.easing).toBe('easeIn');
      expect(r?.focusX).toBe(25);
      expect(r?.focusY).toBe(75);
      expect(r?.cameraShake).toBe(5);
    });

    it('отвергает speed вне диапазона', () => {
      expect(() => effectOverridesSchema.parse({ speed: 0.1 })).toThrow();
      expect(() => effectOverridesSchema.parse({ speed: 3.0 })).toThrow();
    });

    it('отвергает невалидный easing', () => {
      expect(() => effectOverridesSchema.parse({ easing: 'bouncy' })).toThrow();
    });

    it('отвергает focusX вне 0-100', () => {
      expect(() => effectOverridesSchema.parse({ focusX: 150 })).toThrow();
      expect(() => effectOverridesSchema.parse({ focusX: -10 })).toThrow();
    });

    it('отвергает cameraShake > 20', () => {
      expect(() => effectOverridesSchema.parse({ cameraShake: 30 })).toThrow();
    });

    it('strict: отвергает неизвестные поля', () => {
      expect(() => effectOverridesSchema.parse({ randomField: 1 })).toThrow();
    });

    it('null допустим', () => {
      expect(effectOverridesSchema.parse(null)).toBeNull();
    });
  });

  describe('updateProjectSchema — новые поля', () => {
    it('принимает zoomSpeed/zoomEasing/cameraShake', () => {
      const r = updateProjectSchema.parse({ zoomSpeed: 1.5, zoomEasing: 'easeOut', cameraShake: 8 });
      expect(r.zoomSpeed).toBe(1.5);
      expect(r.zoomEasing).toBe('easeOut');
      expect(r.cameraShake).toBe(8);
    });

    it('отвергает zoomSpeed вне диапазона', () => {
      expect(() => updateProjectSchema.parse({ zoomSpeed: 0.2 })).toThrow();
      expect(() => updateProjectSchema.parse({ zoomSpeed: 5 })).toThrow();
    });

    it('отвергает невалидный zoomEasing', () => {
      expect(() => updateProjectSchema.parse({ zoomEasing: 'invalid' })).toThrow();
    });
  });
});
