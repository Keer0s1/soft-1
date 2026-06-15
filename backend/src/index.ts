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

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // запас под загрузку картинок (base64)

// API
app.use('/api/meta', metaRouter);
app.use('/api/projects', projectsRouter);
app.use('/api', scenesRouter);
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

app.listen(env.PORT, () => {
  console.log(`Backend на http://localhost:${env.PORT}`);
  if (!env.VOICER_API_KEY || !env.FASTGEN_API_KEY) {
    console.warn('⚠️  Не заданы VOICER_API_KEY / FASTGEN_API_KEY — заполни .env');
  }
});
