// Генерация картинок ПОШТУЧНО на уровне сцены, с авто-ретраем.
// Функции не бросают исключений наружу — статус/ошибка пишутся в сцену,
// чтобы их можно было вызывать «в фоне» и в пуле без обёрток.

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { env } from '../env.js';
import * as fastgen from '../lib/fastgen.js';
import { rel, abs, projectDir } from '../lib/paths.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ATTEMPTS = 3; // авто-ретрай: их API часто отдаёт ошибки

function removeFileQuiet(relPath?: string | null) {
  if (!relPath) return;
  try {
    const p = abs(relPath);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  } catch {
    /* не критично */
  }
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

  // seed: «другой вариант» -> новый случайный; иначе повторяем прежний (если был)
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

      const dir = path.join(projectDir(project.id), 'images');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `scene_${sceneId}_${Date.now()}.png`);
      fs.writeFileSync(file, bytes);
      removeFileQuiet(scene.imagePath); // убрать прежнюю картинку

      await prisma.scene.update({
        where: { id: sceneId },
        data: {
          imagePath: rel(file),
          imageStatus: 'done',
          imageError: '',
          imageOpId: opId,
          imageSeed: seed ?? null,
          imageSource: 'ai',
          imageUpdatedAt: new Date(),
        },
      });
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

/** Сохранить загруженную пользователем картинку (data-URI) как картинку сцены. */
export async function saveUploadedImage(sceneId: string, dataUri: string): Promise<void> {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId }, include: { project: true } });
  if (!scene) throw new Error('Сцена не найдена');

  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUri);
  if (!m) throw new Error('Ожидается картинка в формате data:image/...;base64,...');
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  const bytes = Buffer.from(m[2], 'base64');

  const dir = path.join(projectDir(scene.project.id), 'images');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `scene_${sceneId}_${Date.now()}.${ext}`);
  fs.writeFileSync(file, bytes);
  removeFileQuiet(scene.imagePath);

  await prisma.scene.update({
    where: { id: sceneId },
    data: {
      imagePath: rel(file),
      imageStatus: 'done',
      imageError: '',
      imageOpId: null,
      imageSource: 'upload',
      imageUpdatedAt: new Date(),
    },
  });
}
