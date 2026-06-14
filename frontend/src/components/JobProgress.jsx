import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const ACTIVE = new Set(['queued', 'running']);

// Опрашивает статус запуска раз в 2с, показывает прогресс, лог и готовое видео.
export default function JobProgress({ jobId, onDone }) {
  const [job, setJob] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const j = await api.getJob(jobId);
        if (stopped) return;
        setJob(j);
        if (ACTIVE.has(j.status)) {
          timer.current = setTimeout(tick, 2000);
        } else {
          onDone?.(j);
        }
      } catch {
        if (!stopped) timer.current = setTimeout(tick, 3000);
      }
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [jobId]);

  if (!job) return <div className="panel">Запуск задачи…</div>;

  const pct =
    job.scenesCount > 0 ? Math.round((job.imagesDone / job.scenesCount) * 100) : 0;
  const log = Array.isArray(job.log) ? job.log : [];

  return (
    <div className="panel job">
      <div className="job-head">
        <strong>{job.step || job.status}</strong>
        <span className={`tag tag-${job.status}`}>{job.status}</span>
      </div>

      {ACTIVE.has(job.status) && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
          <span className="progress-label">
            картинки {job.imagesDone}/{job.scenesCount}
          </span>
        </div>
      )}

      {job.status === 'error' && <div className="error-box">{job.error}</div>}

      {job.status === 'done' && job.outputPath && (
        <div className="result">
          <video src={`/files/${job.outputPath}`} controls style={{ width: '100%' }} />
          <a className="btn" href={`/files/${job.outputPath}`} download>
            ⬇ Скачать MP4
          </a>
        </div>
      )}

      {Array.isArray(job.results) && job.results.length > 0 && (
        <details className="scene-results">
          <summary>Сцены и использованные промты ({job.results.length})</summary>
          <div className="results-grid">
            {job.results.map((r) => (
              <div key={r.id} className="result-card">
                {r.imagePath ? (
                  <img src={`/files/${r.imagePath}`} alt={`сцена ${r.order + 1}`} />
                ) : (
                  <div className={`thumb-placeholder ${r.status}`}>{r.status}</div>
                )}
                <div className="result-card-body">
                  <strong>#{r.order + 1}</strong>
                  {r.durationSec != null && <span className="muted small"> · {r.durationSec.toFixed(1)}с</span>}
                  <p className="prompt" title={r.imagePrompt}>🖼 {r.imagePrompt}</p>
                  <p className="voice" title={r.voiceText}>🎙 {r.voiceText}</p>
                  {r.status === 'error' && <p className="error-box small">{r.error}</p>}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <details className="log">
        <summary>Лог ({log.length})</summary>
        <pre>{log.join('\n')}</pre>
      </details>
    </div>
  );
}
