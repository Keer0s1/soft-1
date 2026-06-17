import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { api } from '../api.js';
import { useSocket } from '../useSocket.js';
import { useTimelineState } from '../useTimelineState.js';
import { toast } from '../components/Toast.jsx';
import JobProgress from '../components/JobProgress.jsx';
import ImportDialog from '../components/ImportDialog.jsx';
import SceneCard from '../components/SceneCard.jsx';
import EffectsPanel from '../components/EffectsPanel.jsx';
import InteractiveTimeline from '../components/InteractiveTimeline.jsx';
import NleTimeline from '../components/NleTimeline.jsx';
import SfxTrack from '../components/SfxTrack.jsx';
import CtaTrack from '../components/CtaTrack.jsx';
import OverlayTrack from '../components/OverlayTrack.jsx';
import PreviewPlayer from '../components/PreviewPlayer.jsx';
import PreviewFxPanel from '../components/PreviewFxPanel.jsx';
import { resolveEffectsFront } from '../resolveEffects.js';

const IMG_FIELDS = ['imageStatus', 'imagePath', 'imageError', 'imageSource', 'imageUpdatedAt', 'activeImageId', 'images'];

export default function EditorPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [providers, setProviders] = useState({ providers: [], aspectRatios: [] });
  const [templates, setTemplates] = useState(null);
  const [effects, setEffects] = useState(null);
  const [luts, setLuts] = useState([]);
  const [musicList, setMusicList] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [fxSceneId, setFxSceneId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState('');
  const [block, setBlock] = useState({ canAssemble: false, blockReason: 'Загрузка…' });
  const [vpVersion, setVpVersion] = useState(0);
  const pollRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const timeline = useTimelineState(scenes);

  // WebSocket — мгновенные обновления вместо поллинга
  useSocket(id, {
    'scene:image:done': () => refreshStatus(),
    'scene:image:error': () => refreshStatus(),
    'job:step': ({ step }) => setActiveJobStep?.(step),
    'job:done': () => { setActiveJob(null); load(); toast('Ролик собран!', 'success'); },
    'job:error': ({ error }) => { setActiveJob(null); load(); toast(error || 'Ошибка сборки', 'error'); },
    'voice:preview:done': () => load(),
    'voice:preview:error': ({ error }) => { load(); toast(error || 'Ошибка озвучки', 'error'); },
    'videoPreview:done': () => { load(); setVpVersion(v => v + 1); },
    'videoPreview:error': ({ error }) => { load(); if (error) toast(error, 'error'); },
    'videoPreview:progress': ({ percent }) => setProject(p => p ? { ...p, videoPreviewStatus: 'rendering', _vpPercent: percent || 0 } : p),
  });

  async function load() {
    const p = await api.getProject(id);
    setProject(p);
    setScenes(p.scenes);
  }
  useEffect(() => {
    load();
    api.providers().then(setProviders).catch(() => {});
    api.voicerTemplates().then((l) => setTemplates(Array.isArray(l) ? l : [])).catch(() => setTemplates([]));
    api.effects().then(setEffects).catch(() => {});
    api.luts().then(setLuts).catch(() => {});
    api.musicList().then(setMusicList).catch(() => {});
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
      pollRef.current = setInterval(refreshStatus, 1500);
    } else if (!anyPending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setGenerating(false);
      refreshStatus();
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
  const withImg = scenes.filter((s) => s.imagePath); // для превью эффектов на реальных картинках
  const counts = {
    done: scenes.filter((s) => s.imageStatus === 'done').length,
    pending: scenes.filter((s) => s.imageStatus === 'pending').length,
    error: scenes.filter((s) => s.imageStatus === 'error').length,
    none: scenes.filter((s) => s.imageStatus === 'none' || !s.imageStatus).length,
  };

  function patchSetting(patch) {
    setProject((p) => ({ ...p, ...patch }));
    api.updateProject(id, patch).catch((e) => setError(e.message));
  }

  async function renderVideoPreview() {
    setProject(p => p ? { ...p, videoPreviewStatus: 'rendering', _vpPercent: 0 } : p);
    api.videoPreview(id).catch(() => {});
    // Poll until done
    const poll = setInterval(async () => {
      try {
        const p = await api.getProject(id);
        if (p.videoPreviewStatus === 'done' || p.videoPreviewStatus === 'error') {
          clearInterval(poll);
          setProject(p);
          setScenes(p.scenes);
          setVpVersion(v => v + 1);
        } else {
          setProject(prev => prev ? { ...prev, _vpPercent: p._vpPercent || prev._vpPercent } : prev);
        }
      } catch {}
    }, 2000);
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
    setGenerating(true);
    await api.genMissingImages(id);
    setScenes((arr) =>
      arr.map((s) => (s.imageStatus === 'none' || s.imageStatus === 'error' ? { ...s, imageStatus: 'pending' } : s)),
    );
  }

  async function cancelGeneration() {
    await api.cancelImages(id);
    setGenerating(false);
    await refreshStatus();
  }

  async function retryErrors() {
    setGenerating(true);
    setShowErrors(false);
    await api.genMissingImages(id);
    setScenes((arr) =>
      arr.map((s) => (s.imageStatus === 'error' || s.imageStatus === 'none' ? { ...s, imageStatus: 'pending' } : s)),
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

  async function assembleShorts() {
    setError('');
    try {
      const { jobId } = await api.startJob(id, { format: '9:16' });
      setActiveJob(jobId);
    } catch (e) {
      setError(e.message);
    }
  }

  async function previewVoice() {
    setProject((p) => ({ ...p, voicePreviewStatus: 'pending', voicePreviewError: '' }));
    await api.voicePreview(id).catch((e) => setError(e.message));
  }

  function uploadVoice() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          await api.uploadVoice(id, ev.target.result);
          await load();
          toast('Озвучка загружена', 'success');
        } catch (err) { setError(err.message); }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  async function removeCustomVoice() {
    await api.removeCustomVoice(id);
    await load();
  }

  // Drag-and-drop сцен
  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scenes.findIndex((s) => s.id === active.id);
    const newIndex = scenes.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(scenes, oldIndex, newIndex);
    setScenes(reordered);
    api.reorderScenes(id, reordered.map((s) => s.id)).catch(() => {});
  }

  const resolved = project && scenes.length ? resolveEffectsFront(scenes, project) : null;

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

      {(generating || counts.pending > 0) && (
        <div className="gen-progress-bar">
          <div className="gen-progress-fill" style={{ width: `${scenes.length ? (counts.done / scenes.length) * 100 : 0}%` }} />
          <span className="gen-progress-text">
            🖼 {counts.done}/{scenes.length} готово · {counts.pending} генерится
          </span>
        </div>
      )}

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

      {/* Quick effects toggles */}
      <div className="panel quick-fx">
        <label className="qfx-toggle">
          <input type="checkbox" checked={project.zoomEnabled} onChange={(e) => patchSetting({ zoomEnabled: e.target.checked })} />
          Зум
        </label>
        <label className="qfx-toggle">
          <input type="checkbox" checked={project.transitionEnabled} onChange={(e) => patchSetting({ transitionEnabled: e.target.checked })} />
          Переходы
        </label>
        <label className="qfx-toggle">
          <input type="checkbox" checked={project.subtitlesEnabled} onChange={(e) => patchSetting({ subtitlesEnabled: e.target.checked })} />
          Субтитры
        </label>
        <label className="qfx-quality">
          <select value={project.renderQuality} onChange={(e) => patchSetting({ renderQuality: e.target.value })}>
            {(effects?.qualities || []).map((q) => (
              <option key={q.id} value={q.id}>{q.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Тонкая настройка (collapsed) */}
      <EffectsPanel
        project={project}
        effects={effects}
        onPatch={patchSetting}
        sampleA={withImg[0] ? `/files/${withImg[0].imagePath}` : undefined}
        sampleB={withImg[1] ? `/files/${withImg[1].imagePath}` : undefined}
        luts={luts}
        musicList={musicList}
        scenes={scenes}
        projectId={id}
        onMusicUploaded={async (dataUri) => {
          const r = await api.uploadMusic(id, dataUri);
          if (r?.path) patchSetting({ bgMusicPath: r.path });
        }}
      />

      {/* ─── ЭТАП 2: Сценарий + картинки ─── */}
      <div className="scenes-head">
        <h2>Сцены <span className="muted small">({scenes.length})</span></h2>
        <button className="ghost" onClick={() => setShowImport(true)}>📋 Импорт из текста</button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
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
                onRefresh={load}
                effects={effects}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="scenes-actions">
        <button className="ghost" onClick={addScene}>+ Сцена</button>
        <div className="spacer" />
        {(counts.error > 0 || counts.none > 0) && (
          <button className="ghost danger" onClick={() => setShowErrors(true)}>
            🔴 Не готово ({counts.error + counts.none})
          </button>
        )}
        <button className="ghost" onClick={generateAll} disabled={!scenes.length || generating}>
          🖼 Сгенерировать картинки
        </button>
        <button className="cancel-gen-btn" onClick={cancelGeneration} disabled={!generating}>
          ✕ Отменить генерацию
        </button>
      </div>

      {showErrors && (
        <div className="modal-backdrop" onClick={() => setShowErrors(false)}>
          <div className="modal errors-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ошибки генерации</h3>
            <div className="errors-list">
              {scenes.filter((s) => s.imageStatus === 'error' || s.imageStatus === 'none').map((s, i) => (
                <div key={s.id} className="error-row">
                  <span className="error-num">#{scenes.indexOf(s) + 1}</span>
                  <span className="error-msg">{s.imageError || 'не сгенерировано'}</span>
                </div>
              ))}
            </div>
            <button className="retry-errors-btn" onClick={retryErrors}>
              🔄 Перегенерировать все ошибки
            </button>
            <button className="ghost small" onClick={() => setShowErrors(false)} style={{ marginTop: 8 }}>Закрыть</button>
          </div>
        </div>
      )}

      {/* ─── ЭТАП 3: Превью ─── */}
      <PreviewPlayer scenes={scenes} timeline={timeline} voicePreviewPath={project?.voicePreviewPath} project={project} onPatch={patchSetting} videoPreviewPath={project?.videoPreviewPath} videoPreviewStatus={project?.videoPreviewStatus} onRenderPreview={renderVideoPreview} vpPercent={project?._vpPercent || 0} vpVersion={vpVersion} />
      <NleTimeline projectId={id} scenes={scenes} timeline={timeline} effects={effects} onRefresh={load} project={project} onOpenFx={(sceneId) => setFxSceneId(sceneId)} fxSceneId={fxSceneId} />
      {fxSceneId && scenes.find(s => s.id === fxSceneId) && (
        <PreviewFxPanel
          scenes={scenes}
          currentIndex={scenes.findIndex(s => s.id === fxSceneId)}
          project={project}
          effects={effects}
          onClose={() => setFxSceneId(null)}
          onPatchProject={patchSetting}
          onPatchScene={(sceneId, overrides) => {
            api.updateScene(id, sceneId, { effectOverrides: overrides }).then(() => {
              setScenes(ss => ss.map(s => s.id === sceneId ? { ...s, effectOverrides: overrides } : s));
            }).catch(() => {});
          }}
          onJumpToScene={(idx) => {
            const t = (timeline.boundaries?.[idx] ?? 0) + 0.05;
            timeline.seek(t);
            setFxSceneId(scenes[idx]?.id || null);
          }}
          onRenderPreview={renderVideoPreview}
        />
      )}
      <CtaTrack projectId={id} timeline={timeline} onChanged={refreshStatus} />
      <OverlayTrack projectId={id} timeline={timeline} onChanged={refreshStatus} />

      {/* ─── ЭТАП 4: Озвучка + сборка ─── */}
      {scenes.length > 0 && (
        <div className="panel assemble">
          <div className="assemble-summary">
            <span className="chip badge-done">🟢 готово {counts.done}/{scenes.length}</span>
            {counts.pending > 0 && <span className="chip badge-pending">🟡 генерится {counts.pending}</span>}
            {counts.error > 0 && <span className="chip badge-error">🔴 ошибок {counts.error}</span>}
            {counts.none > 0 && <span className="chip badge-none">⚪ без фото {counts.none}</span>}
          </div>
          <div className="assemble-actions">
            <button className="ghost" onClick={previewVoice} disabled={project.voicePreviewStatus === 'pending'}>
              {project.voicePreviewStatus === 'pending' ? '🎙 озвучиваю…' : '🎙 Озвучить'}
            </button>
            <button className="ghost" onClick={uploadVoice}>
              ⬆ Своя озвучка
            </button>
            {project.customVoicePath && (
              <button className="ghost small danger" onClick={removeCustomVoice} title="Убрать свою озвучку, вернуться к AI">
                ✕ убрать свою
              </button>
            )}
            <button className="primary" onClick={assemble} disabled={!block.canAssemble}>
              ▶ Собрать ролик
            </button>
            <button className="ghost" onClick={assembleShorts} disabled={!block.canAssemble} title="Экспорт в формате 9:16 для YouTube Shorts / Reels / TikTok">
              📱 Shorts
            </button>
          </div>
          {project.customVoicePath && (
            <div className="muted small">📎 Используется своя озвучка (не AI)</div>
          )}
          {!project.customVoicePath && project.voicePreviewStatus === 'done' && (
            <div className="muted small">✓ Озвучка готова — при сборке не будет тратить лимиты</div>
          )}
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

      {/* Встроенный видеоплеер для последнего готового ролика */}
      {(() => {
        const lastDone = project.jobs?.find((j) => j.status === 'done' && j.outputPath);
        if (!lastDone) return null;
        return (
          <div className="panel" style={{ marginTop: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Последний ролик</h3>
            <video
              src={`/files/${lastDone.outputPath}`}
              controls
              style={{ width: '100%', borderRadius: 10, background: '#000' }}
            />
          </div>
        );
      })()}

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
          <a className="btn btn-download small" href={`/files/${job.outputPath}`} download onClick={(e) => e.stopPropagation()}>
            ⬇ скачать
          </a>
        )}
      </div>
      {open && <JobProgress jobId={job.id} />}
    </div>
  );
}
