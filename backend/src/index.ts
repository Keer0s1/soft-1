import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { projectsRouter } from './routes/projects.js';
import { jobsRouter } from './routes/jobs.js';
import { metaRouter } from './routes/meta.js';
import { scenesRouter } from './routes/scenes.js';
import { sfxRouter } from './routes/sfx.js';
import { ctaRouter } from './routes/cta.js';
import { overlaysRouter } from './routes/overlays.js';
import { taskQueue } from './lib/taskQueue.js';
import { initSocket } from './lib/socket.js';
import { prisma } from './db.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// API
app.use('/api/meta', metaRouter);
app.use('/api/projects', projectsRouter);
app.use('/api', scenesRouter);
app.use('/api', sfxRouter);
app.use('/api', ctaRouter);
app.use('/api', overlaysRouter);
app.use('/api', jobsRouter);

// Готовые файлы (озвучка, картинки, видео) из DATA_DIR
app.use('/files', express.static(env.DATA_DIR));

// Собранный фронтенд (если есть): frontend/dist
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(here, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

const server = app.listen(env.PORT, () => {
  console.log(`Backend на http://localhost:${env.PORT} | IMAGE_CONCURRENCY=${env.IMAGE_CONCURRENCY}`);
  if (!env.VOICER_API_KEY || !env.FASTGEN_API_KEY) {
    console.warn('⚠️  Не заданы VOICER_API_KEY / FASTGEN_API_KEY — заполни .env');
  }
});

initSocket(server);

// Помечаем зависшие Job (были running при прошлом крахе) как error
async function markStaleJobs() {
  await prisma.job.updateMany({
    where: { status: 'running' },
    data: { status: 'error', error: 'Сервер был перезапущен во время выполнения', finishedAt: new Date() },
  });
}
markStaleJobs().catch((e) => console.error('markStaleJobs:', e));

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n${signal} — завершаю…`);
  await taskQueue.shutdown();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
