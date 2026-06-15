// Генерация картинок ПОШТУЧНО на уровне сцены, с авто-ретраем.
// Каждый успешный результат сохраняется как ВАРИАНТ (SceneImage), активный
// вариант запоминается в Scene.activeImageId — можно вернуться к любому прошлому.
// Функции не бросают исключений наружу — статус/ошибка пишутся в сцену.

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { env } from '../env.js';
import * as fastgen from '../lib/fastgen.js';
import { rel, projectDir } from '../lib/paths.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ATTEMPTS = 3; // авто-ретрай: их API часто отдаёт ошибки

/** Сделать вариант активным: проставить путь/статус на сцене. */
async function setActive(sceneId: string, img: { id: string; path: string; source: string; seed: number | null; opId: string | null }) {
  await prisma.scene.update({
    where: { id: sceneId },
    data: {
      imagePath: img.path,
      imageStatus: 'done',
      imageError: '',
      imageOpId: img.opId,
      imageSeed: img.seed,
      imageSource: img.source,
      imageUpdatedAt: new Date(),
      activeImageId: img.id,
    },
  });
}

/** Сгенерировать (или пере-генерировать) картинку одной сцены. */
export async function generateSceneImage(
  sceneId: string,
  opts: { newSeed?: boolean } = {},
): Promise<void> {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId }, include: { project: true } });
  if (!scene) return;
  const project = scene.project;

  await prisma.scene.update({ where: { id: sceneId }, data: { imageStatus: 'pending', imageError: '' } });

  const seed = opts.newSeed
    ? Math.floor(Math.random() * 2_000_000_000)
    : scene.imageSeed ?? undefined;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const opId = await fastgen.submitImage(scene.imagePrompt, {
        provider: project.provider,
        model: project.model,
        aspectRatio: project.aspectRatio,
        seed: seed ?? null,
      });
      const bytes = await fastgen.waitForImage(opId);

      const dir = path.join(projectDir(project.id, project.folderName), 'images');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `scene_${sceneId}_${Date.now()}.png`);
      fs.writeFileSync(file, bytes);

      const variant = await prisma.sceneImage.create({
        data: { sceneId, path: rel(file), source: 'ai', seed: seed ?? null, prompt: scene.imagePrompt, opId },
      });
      await setActive(sceneId, variant);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < ATTEMPTS) await sleep(1500 * attempt);
    }
  }

  await prisma.scene.update({
    where: { id: sceneId },
    data: { imageStatus: 'error', imageError: String((lastErr as any)?.message ?? lastErr) },
  });
}

/** Сгенерировать картинки для всех сцен без готовой картинки (none/error). */
export async function generateMissing(projectId: string): Promise<void> {
  const scenes = await prisma.scene.findMany({
    where: { projectId, imageStatus: { in: ['none', 'error'] } },
    orderBy: { order: 'asc' },
  });
  if (scenes.length === 0) return;

  let next = 0;
  const limit = Math.min(env.IMAGE_CONCURRENCY, scenes.length);
  const runner = async () => {
    for (;;) {
      const i = next++;
      if (i >= scenes.length) return;
      await generateSceneImage(scenes[i].id);
    }
  };
  await Promise.all(Array.from({ length: limit }, runner));
}

/** Сохранить загруженную пользователем картинку (data-URI) как вариант сцены. */
export async function saveUploadedImage(sceneId: string, dataUri: string): Promise<void> {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId }, include: { project: true } });
  if (!scene) throw new Error('Сцена не найдена');

  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUri);
  if (!m) throw new Error('Ожидается картинка в формате data:image/...;base64,...');
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  const bytes = Buffer.from(m[2], 'base64');

  const dir = path.join(projectDir(scene.project.id, scene.project.folderName), 'images');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `scene_${sceneId}_${Date.now()}.${ext}`);
  fs.writeFileSync(file, bytes);

  const variant = await prisma.sceneImage.create({
    data: { sceneId, path: rel(file), source: 'upload', prompt: scene.imagePrompt },
  });
  await setActive(sceneId, { ...variant, opId: null });
}

/** Выбрать прошлый вариант картинки активным. */
export async function setActiveImage(sceneId: string, imageId: string): Promise<void> {
  const img = await prisma.sceneImage.findUnique({ where: { id: imageId } });
  if (!img || img.sceneId !== sceneId) throw new Error('Вариант картинки не найден');
  await setActive(sceneId, img);
}
