import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import JobProgress from '../components/JobProgress.jsx';
import ImportDialog from '../components/ImportDialog.jsx';

const emptyScene = () => ({ voiceText: '', imagePrompt: '' });

export default function EditorPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([emptyScene()]);
  const [providers, setProviders] = useState({ providers: [], aspectRatios: [] });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState(null); // null=загрузка, []=пусто
  const [templatesError, setTemplatesError] = useState('');

  async function load() {
    const p = await api.getProject(id);
    setProject(p);
    setScenes(p.scenes.length ? p.scenes.map((s) => ({ voiceText: s.voiceText, imagePrompt: s.imagePrompt })) : [emptyScene()]);
  }
  useEffect(() => {
    load();
    api.providers().then(setProviders).catch(() => {});
    api
      .voicerTemplates()
      .then((list) => setTemplates(Array.isArray(list) ? list : []))
      .catch((e) => {
        setTemplates([]);
        setTemplatesError(e.message);
      });
  }, [id]);

  if (!project) return <p className="muted">Загрузка…</p>;

  const totalChars = scenes.reduce((n, s) => n + (s.voiceText?.length || 0), 0);

  function patchSetting(patch) {
    setProject((p) => ({ ...p, ...patch }));
    api.updateProject(id, patch).catch((e) => setError(e.message));
  }

  function updateScene(i, field, value) {
    setScenes((arr) => arr.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  }
  const addScene = () => setScenes((arr) => [...arr, emptyScene()]);
  const removeScene = (i) => setScenes((arr) => arr.filter((_, idx) => idx !== i));
  function moveScene(i, dir) {
    setScenes((arr) => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const copy = [...arr];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  async function saveScenes() {
    setSaving(true);
    setError('');
    try {
      await api.saveScenes(id, scenes);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    setError('');
    await saveScenes();
    try {
      const { jobId } = await api.startJob(id);
      setActiveJob(jobId);
    } catch (e) {
      setError(e.message);
    }
  }

  const providerInfo = providers.providers.find((p) => p.id === project.provider);

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

      {/* Настройки генерации */}
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
            <select value={project.model ?? providerInfo.models[0]} onChange={(e) => patchSetting({ model: e.target.value })}>
              {providerInfo.models.map((m) => (
                <option key={m} value={m}>{m}</option>
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
            <select disabled>
              <option>загрузка…</option>
            </select>
          ) : (
            <select
              value={project.voiceTemplateId ?? ''}
              onChange={(e) => patchSetting({ voiceTemplateId: e.target.value || null })}
            >
              <option value="">Голос по умолчанию</option>
              {templates.map((t) => (
                <option key={t.uuid} value={t.uuid}>
                  {t.name || t.uuid.slice(0, 8)}
                  {t.broken ? ' (повреждён)' : ''}
                </option>
              ))}
            </select>
          )}
          {templates?.length === 0 && !templatesError && (
            <span className="muted small">нет шаблонов — создай голос в Telegram-боте Voicer</span>
          )}
          {templatesError && <span className="muted small">шаблоны не загрузились: {templatesError}</span>}
        </label>
      </div>

      {/* Сцены */}
      <div className="scenes-head">
        <h2>Сцены <span className="muted small">({scenes.length}, ~{totalChars} симв.)</span></h2>
        <div>
          <button className="ghost" onClick={() => setShowImport(true)}>📋 Импорт из текста</button>
        </div>
      </div>

      <div className="scenes">
        {scenes.map((s, i) => (
          <div className="scene" key={i}>
            <div className="scene-num">
              <span>{i + 1}</span>
              <div className="scene-move">
                <button className="icon-btn" onClick={() => moveScene(i, -1)} disabled={i === 0}>▲</button>
                <button className="icon-btn" onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1}>▼</button>
              </div>
            </div>
            <div className="scene-fields">
              <label>
                Текст озвучки
                <textarea
                  rows={3}
                  value={s.voiceText}
                  onChange={(e) => updateScene(i, 'voiceText', e.target.value)}
                  placeholder="Что будет звучать в этой сцене…"
                />
              </label>
              <label>
                Промт картинки
                <textarea
                  rows={2}
                  value={s.imagePrompt}
                  onChange={(e) => updateScene(i, 'imagePrompt', e.target.value)}
                  placeholder="Image prompt (лучше на английском)…"
                />
              </label>
            </div>
            <button className="icon-btn danger" title="Удалить сцену" onClick={() => removeScene(i)} disabled={scenes.length === 1}>✕</button>
          </div>
        ))}
      </div>

      <div className="scenes-actions">
        <button className="ghost" onClick={addScene}>+ Сцена</button>
        <div className="spacer" />
        <button className="ghost" onClick={saveScenes} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button className="primary" onClick={generate} disabled={saving}>
          ▶ Сгенерировать ролик
        </button>
      </div>
      {savedAt && <div className="muted small right">сохранено {savedAt.toLocaleTimeString('ru-RU')}</div>}
      {error && <div className="error-box">{error}</div>}

      {/* Активный запуск */}
      {activeJob && (
        <>
          <h2>Сборка</h2>
          <JobProgress jobId={activeJob} onDone={() => load()} />
        </>
      )}

      {/* История запусков */}
      {project.jobs?.length > 0 && (
        <>
          <h2>История</h2>
          <div className="history">
            {project.jobs.map((j) => (
              <HistoryRow key={j.id} job={j} />
            ))}
          </div>
        </>
      )}

      {showImport && (
        <ImportDialog
          projectId={id}
          onClose={() => setShowImport(false)}
          onImported={(imported) => {
            setScenes(imported.length ? imported : [emptyScene()]);
            setShowImport(false);
          }}
        />
      )}
    </div>
  );
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
          <a className="link" href={`/files/${job.outputPath}`} onClick={(e) => e.stopPropagation()}>
            видео
          </a>
        )}
      </div>
      {open && <JobProgress jobId={job.id} />}
    </div>
  );
}
