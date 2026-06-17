import { EventEmitter } from 'node:events';

export interface TaskEntry {
  id: string;
  type: string;
  status: 'running' | 'done' | 'error';
  startedAt: Date;
  error?: string;
}

class TaskQueue extends EventEmitter {
  private tasks = new Map<string, TaskEntry>();
  private abortControllers = new Map<string, AbortController>();

  get running(): TaskEntry[] {
    return [...this.tasks.values()].filter((t) => t.status === 'running');
  }

  has(id: string): boolean {
    const t = this.tasks.get(id);
    return !!t && t.status === 'running';
  }

  run(id: string, type: string, fn: (signal: AbortSignal) => Promise<void>): void {
    if (this.has(id)) return;

    const ac = new AbortController();
    const entry: TaskEntry = { id, type, status: 'running', startedAt: new Date() };
    this.tasks.set(id, entry);
    this.abortControllers.set(id, ac);

    fn(ac.signal)
      .then(() => {
        entry.status = 'done';
        this.emit('done', entry);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        entry.status = 'error';
        entry.error = String(e?.message ?? e);
        this.emit('error', entry);
        console.error(`[TaskQueue] ${type}/${id} failed:`, e?.message ?? e);
      })
      .finally(() => {
        this.abortControllers.delete(id);
      });
  }

  cancel(id: string): boolean {
    const ac = this.abortControllers.get(id);
    if (!ac) return false;
    ac.abort();
    const entry = this.tasks.get(id);
    if (entry) entry.status = 'error';
    this.abortControllers.delete(id);
    return true;
  }

  async shutdown(): Promise<void> {
    for (const [id, ac] of this.abortControllers) {
      ac.abort();
      const entry = this.tasks.get(id);
      if (entry) entry.status = 'error';
    }
    this.abortControllers.clear();
  }
}

export const taskQueue = new TaskQueue();
