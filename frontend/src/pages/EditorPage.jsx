import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import JobProgress from '../components/JobProgress.jsx';
import ImportDialog from '../components/ImportDialog.jsx';
import SceneCard from '../components/SceneCard.jsx';

const IMG_FIELDS = ['imageStatus', 'imagePath', 'imageError', 'imageSource', 'imageUpdatedAt'];

export default function EditorPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [providers, setProviders] = useState({ providers: [], aspectRatios: [] });
  const [templates, setTemplates] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');
  const [block, setBlock] = useState({ canAssemble: false, blockReason: 'Загрузка…' });
  const pollRef = useRef(null);

  async function load() {
    const p = await api.getProject(id);
    setProject(p);
    setScenes(p.scenes);
  }
  useEffect(() => {
    load();
    api.providers().then(setProviders).catch(() => {});
    api.voicerTemplates().then((l) => setTemplates(Array.isArray(l) ? l : [])).catch(() => setTemplates([]));
  }, [id]);

  // Подмешать свежие статусы картинок (не трогая текст/промт)
  async function refreshStatus() {
    try {
      const { scenes: st, canAssemble, blockReason } = await api.scenesStatus(id);
      const byId = Object.fromEntries(st.map((s) => [s.id, s]));
      setScenes((arr) =>
        arr.map((s) => {
          const u = byId[s.id];
          if (!u) return s;
          const merged = { ...s };
          for (const f of IMG_FIELDS) merged[f] = u[f];
          return merged;
        }),
      );
      setBlock({ canAssemble, blockReason });
    } catch {
      /* пропускаем тик */
    }
  }

  // Поллим статусы, пока есть генерящиеся картинки
  const anyPending = scenes.some((s) => s.imageStatus === 'pending');
  useEffect(() => {
    if (anyPending && !pollRef.current) {
      pollRef.current = setInterval(refreshStatus, 2500);
    } else if (!anyPending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      refreshStatus(); // финальное обновление (canAssemble и т.п.)
    }
    return () => {};
  }, [anyPending]);
  useEffect(() => () => clearInterval(pollRef.current), []);
  // первичная загрузка статуса сборки
  useEffect(() => {
    if (scenes.length) refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes.length]);

  // Превью озвучки — поллим проект, пока статус pending
  useEffect(() => {
    if (project?.voicePreviewStatus !== 'pending') return;
    const t = setInterval(async () => {
      const p = await api.getProject(id);
      setProject((prev) => ({ ...prev, ...pickPreview(p) }));
      if (p.voicePreviewStatus !== 'pending') clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
  }, [project?.voicePreviewStatus, id]);

  if (!project) return <p className="muted">Загрузка…</p>;

  const providerInfo = providers.providers.find((p) => p.id === project.provider);
  const counts = {
    done: scenes.filter((s) => s.imageStatus === 'done').length,
    pending: scenes.filter((s) => s.imageStatus === 'pending').length,
    error: scenes.filter((s) => s.imageStatus === 'error').length,
  };

  function patchSetting(patch) {
    setProject((p) => ({ ...p, ...patch }));
    api.updateProject(id, patch).catch((e) => setError(e.message));
  }

  async function addScene() {
    const s = await api.addScene(id, {});
    setScenes((arr) => [...arr, s]);
  }
  async function removeScene(sceneId) {
    await api.deleteScene(id, sceneId);
    setScenes((arr) => arr.filter((s) => s.id !== sceneId));
  }
  async function moveScene(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= scenes.length) return;
    const arr = [...scenes];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setScenes(arr);
    await api.reorderScenes(id, arr.map((s) => s.id)).catch(() => {});
  }

  async function generateAll() {
    setError('');
    await api.genMissingImages(id);
    // оптимистично помечаем недостающие как pending, чтобы запустить поллинг
    setScenes((arr) =>
      arr.map((s) => (s.imageStatus === 'none' || s.imageStatus === 'error' ? { ...s, imageStatus: 'pending' } : s)),
    );
  }

  function markPending(sceneId) {
    setScenes((arr) => arr.map((s) => (s.id === sceneId ? { ...s, imageStatus: 'pending' } : s)));
  }

  async function assemble() {
    setError('');
    try {
      const { jobId } = await api.startJob(id);
      setActiveJob(jobId);
    } catch (e) {
      setError(e.message);
    }
  }

  async function previewVoice() {
    setProject((p) => ({ ...p, voicePreviewStatus: 'pending', voicePreviewError: '' }));
    await api.voicePreview(id).catch((e) => setError(e.message));
  }

  return (
    <div className="editor">
      <div className="editor-head">
        <Link to="/" className="back">← к списку</Link>
        <input
          className="title-input"
          value={project.title}
          onChange={(e) => setProject((p) => ({ ...p, title: e.target.value }))}
          onBlur={(e) => patchSetting({ title: e.target.value })}
        />
      </div>

      {/* Настройки */}
      <div className="panel settings">
        <label>
          Провайдер картинок
          <select value={project.provider} onChange={(e) => patchSetting({ provider: e.target.value, model: null })}>
            {providers.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        {providerInfo?.models?.length > 0 && (
          <label>
            Модель
            <select
              value={project.model ?? providerInfo.models[0].code}
              onChange={(e) => patchSetting({ model: e.target.value })}
            >
              {providerInfo.models.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}{m.default ? ' ★' : ''}{m.experimental ? ' (beta)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Формат
          <select value={project.aspectRatio} onChange={(e) => patchSetting({ aspectRatio: e.target.value })}>
            {providers.aspectRatios.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Голос (шаблон Voicer)
          {templates === null ? (
            <select disabled><option>загрузка…</option></select>
          ) : (
            <select value={project.voiceTemplateId ?? ''} onChange={(e) => patchSetting({ voiceTemplateId: e.target.value || null })}>
              <option value="">Голос по умолчанию</option>
              {templates.map((t) => (
                <option key={t.uuid} value={t.uuid}>{t.name || t.uuid.slice(0, 8)}</option>
              ))}
            </select>
          )}
        </label>
      </div>

      {/* Сцены */}
      <div className="scenes-head">
        <h2>Сцены <span className="muted small">({scenes.length})</span></h2>
        <button className="ghost" onClick={() => setShowImport(true)}>📋 Импорт из текста</button>
      </div>

      <div className="scenes">
        {scenes.map((s, i) => (
          <SceneCard
            key={s.id}
            projectId={id}
            scene={s}
            index={i}
            total={scenes.length}
            onMove={(dir) => moveScene(i, dir)}
            onDelete={() => removeScene(s.id)}
            onChanged={() => markPending(s.id)}
          />
        ))}
      </div>

      <div className="scenes-actions">
        <button className="ghost" onClick={addScene}>+ Сцена</button>
        <div className="spacer" />
        <button className="ghost" onClick={generateAll} disabled={!scenes.length || counts.pending > 0}>
          🖼 Сгенерировать картинки
        </button>
      </div>

      {/* Сводка по картинкам + сборка */}
      {scenes.length > 0 && (
        <div className="panel assemble">
          <div className="assemble-summary">
            <span className="chip badge-done">🟢 готово {counts.done}/{scenes.length}</span>
            {counts.pending > 0 && <span className="chip badge-pending">🟡 генерится {counts.pending}</span>}
            {counts.error > 0 && <span className="chip badge-error">🔴 ошибок {counts.error}</span>}
          </div>
          <div className="assemble-actions">
            <button className="ghost" onClick={previewVoice} disabled={project.voicePreviewStatus === 'pending'}>
              {project.voicePreviewStatus === 'pending' ? '🎙 озвучиваю…' : '🎙 Прослушать озвучку'}
            </button>
            <button className="primary" onClick={assemble} disabled={!block.canAssemble}>
              ▶ Собрать ролик
            </button>
          </div>
          {!block.canAssemble && block.blockReason && (
            <div className="muted small right">⚠️ {block.blockReason}</div>
          )}
          {project.voicePreviewStatus === 'done' && project.voicePreviewPath && (
            <audio className="voice-preview" src={`/files/${project.voicePreviewPath}`} controls />
          )}
          {project.voicePreviewStatus === 'error' && (
            <div className="error-box small">{project.voicePreviewError}</div>
          )}
          {project.folderPath && (
            <div className="muted small folder-hint" title="Папка этого ролика на диске (картинки, озвучка, готовое видео)">
              📁 Файлы на диске: <code>{project.folderPath}</code>
            </div>
          )}
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {/* Активная сборка */}
      {activeJob && (
        <>
          <h2>Сборка</h2>
          <JobProgress jobId={activeJob} onDone={() => load()} />
        </>
      )}

      {/* История */}
      {project.jobs?.length > 0 && (
        <>
          <h2>История</h2>
          <div className="history">
            {project.jobs.map((j) => <HistoryRow key={j.id} job={j} />)}
          </div>
        </>
      )}

      {showImport && (
        <ImportDialog
          projectId={id}
          onClose={() => setShowImport(false)}
          onImported={async (imported) => {
            await api.replaceScenes(id, imported);
            setShowImport(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function pickPreview(p) {
  return {
    voicePreviewStatus: p.voicePreviewStatus,
    voicePreviewPath: p.voicePreviewPath,
    voicePreviewError: p.voicePreviewError,
  };
}

function HistoryRow({ job }) {
  const [open, setOpen] = useState(false);
  const date = new Date(job.createdAt).toLocaleString('ru-RU');
  return (
    <div className="history-row">
      <div className="history-summary" onClick={() => setOpen((o) => !o)}>
        <span className={`tag tag-${job.status}`}>{job.status}</span>
        <span>{date}</span>
        <span className="muted small">{job.scenesCount} сцен</span>
        {job.outputPath && (
          <a className="link" href={`/files/${job.outputPath}`} onClick={(e) => e.stopPropagation()}>видео</a>
        )}
      </div>
      {open && <JobProgress jobId={job.id} />}
    </div>
  );
}
