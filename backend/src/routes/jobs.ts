import { Router } from 'express';
import { prisma } from '../db.js';
import { createJob, runJob } from '../services/pipeline.js';
import { taskQueue } from '../lib/taskQueue.js';

export const jobsRouter = Router();

// Запустить сборку проекта: создаём Job и стартуем пайплайн через очередь
jobsRouter.post('/projects/:id/jobs', async (req, res) => {
  try {
    const format = req.body?.format; // optional: '9:16' for Shorts export
    const jobId = await createJob(req.params.id, format ? { format } : undefined);
    taskQueue.run(jobId, 'assembly', () => runJob(jobId));
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
