import { Router } from 'express';
import { prisma } from '../db.js';
import { createJob, runJob } from '../services/pipeline.js';

export const jobsRouter = Router();

// Запустить сборку проекта: создаём Job и стартуем пайплайн в фоне
jobsRouter.post('/projects/:id/jobs', async (req, res) => {
  try {
    const jobId = await createJob(req.params.id);
    // Не ждём завершения — клиент опрашивает статус
    runJob(jobId).catch((e) => console.error('runJob failed:', e));
    res.status(202).json({ jobId });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// История запусков проекта
jobsRouter.get('/projects/:id/jobs', async (req, res) => {
  const jobs = await prisma.job.findMany({
    where: { projectId: req.params.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(jobs);
});

// Статус одного запуска (со снимками сцен — видно, какой промт использовался)
jobsRouter.get('/jobs/:id', async (req, res) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { results: { orderBy: { order: 'asc' } } },
  });
  if (!job) return res.status(404).json({ error: 'Job не найден' });
  res.json(job);
});
