import { useState, useEffect, useRef, useCallback } from 'react';

const ZOOM_PRESETS = [
  { id: 'in', label: 'Наезд' },
  { id: 'out', label: 'Отъезд' },
  { id: 'left', label: 'Влево' },
  { id: 'right', label: 'Вправо' },
  { id: 'up', label: 'Вверх' },
  { id: 'down', label: 'Вниз' },
  { id: 'inUp', label: 'Наезд+вверх' },
  { id: 'inDown', label: 'Наезд+вниз' },
  { id: 'slowDrift', label: 'Дрифт' },
  { id: 'breathe', label: 'Дыхание' },
  { id: 'cinematic', label: 'Кино' },
];

export default function PreviewFxPanel({
  scenes, currentIndex, project, effects,
  onPatchProject, onPatchScene, onJumpToScene, onRenderPreview, onClose,
}) {
  const safeIndex = Math.max(0, Math.min(currentIndex ?? 0, scenes.length - 1));
  const scene = scenes[safeIndex];
  const [tab, setTab] = useState('zoom');
  const [scope, setScope] = useState('scene');
  const [local, setLocal] = useState({});
  const debounceRef = useRef(null);

  useEffect(() => {
    setLocal({ ...(scene?.effectOverrides || {}) });
  }, [scene?.id]);

  const flush = useCallback((next) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const data = Object.keys(next || {}).length > 0 ? next : null;
      onPatchScene(scene.id, data);
    }, 350);
  }, [onPatchScene, scene?.id]);

  const patchScene = useCallback((changes) => {
    const next = { ...local };
    for (const k of Object.keys(changes)) {
      if (changes[k] === undefined) delete next[k];
      else next[k] = changes[k];
    }
    setLocal(next);
    flush(next);
  }, [local, flush]);

  const patchProject = useCallback((changes) => {
    onPatchProject(changes);
  }, [onPatchProject]);

  if (!scene) return null;

  const intensity = scope === 'scene'
    ? (local.zoomIntensity ?? project.zoomIntensity ?? 0.15)
    : (project.zoomIntensity ?? 0.15);
  const speed = scope === 'scene'
    ? (local.speed ?? project.zoomSpeed ?? 1.0)
    : (project.zoomSpeed ?? 1.0);
  const easing = scope === 'scene'
    ? (local.easing ?? project.zoomEasing ?? 'linear')
    : (project.zoomEasing ?? 'linear');
  const focusX = local.focusX ?? 50;
  const focusY = local.focusY ?? 50;
  const shake = scope === 'scene'
    ? (local.cameraShake ?? project.cameraShake ?? 0)
    : (project.cameraShake ?? 0);
  const transDur = scope === 'scene'
    ? (local.transitionDuration ?? project.transitionDuration ?? 0.5)
    : (project.transitionDuration ?? 0.5);

  const sampleA = scene.imagePath ? `/files/${scene.imagePath}` : '/examples/sample1.jpg';
  const nextScene = scenes[safeIndex + 1];
  const sampleB = nextScene?.imagePath ? `/files/${nextScene.imagePath}` : '/examples/sample2.jpg';
  const transitions = effects?.transitions || [];

  const setVal = (changes) => {
    if (scope === 'scene') {
      patchScene(changes);
    } else {
      const map = { zoomIntensity: 'zoomIntensity', speed: 'zoomSpeed', easing: 'zoomEasing', transitionDuration: 'transitionDuration', cameraShake: 'cameraShake' };
      const projectPatch = {};
      for (const k of Object.keys(changes)) {
        const pk = map[k];
        if (pk) projectPatch[pk] = changes[k];
      }
      if (Object.keys(projectPatch).length) patchProject(projectPatch);
    }
  };

  const setZoomPreset = (presetId) => {
    if (scope === 'scene') {
      patchScene({ zoom: presetId });
    } else {
      // project-level: toggle in zoomPresets list
      const list = project.zoomPresets || [];
      if (presetId && !list.includes(presetId)) {
        patchProject({ zoomPresets: [...list, presetId] });
      }
    }
  };

  const setTransPreset = (presetId) => {
    if (scope === 'scene') {
      patchScene({ transition: presetId });
    } else {
      const list = project.transitionPresets || [];
      if (presetId && !list.includes(presetId)) {
        patchProject({ transitionPresets: [...list, presetId] });
      }
    }
  };

  return (
    <div className="pfx-panel">
      <div className="pfx-header">
        <div className="pfx-scene-nav">
          <button className="pfx-nav-btn" disabled={safeIndex === 0}
            onClick={() => onJumpToScene(safeIndex - 1)}>◀</button>
          <span className="pfx-scene-label">
            Сцена <b>{safeIndex + 1}</b> из {scenes.length}
          </span>
          <button className="pfx-nav-btn" disabled={safeIndex >= scenes.length - 1}
            onClick={() => onJumpToScene(safeIndex + 1)}>▶</button>
        </div>
        <div className="pfx-scope">
          <button className={`pfx-scope-btn ${scope === 'scene' ? 'active' : ''}`}
            onClick={() => setScope('scene')}>
            Только эта сцена
          </button>
          <button className={`pfx-scope-btn ${scope === 'project' ? 'active' : ''}`}
            onClick={() => setScope('project')}>
            Для всего ролика
          </button>
        </div>
        {onClose && (
          <button className="btn-icon pfx-close" onClick={onClose} title="Закрыть">✕</button>
        )}
      </div>

      <div className="pfx-tabs">
        <button className={`pfx-tab ${tab === 'zoom' ? 'active' : ''}`} onClick={() => setTab('zoom')}>
          🎬 Движение камеры (зум)
        </button>
        <button className={`pfx-tab ${tab === 'trans' ? 'active' : ''}`} onClick={() => setTab('trans')}
          disabled={safeIndex >= scenes.length - 1 && scope === 'scene'}>
          ↔ Переход к следующей сцене
        </button>
      </div>

      {tab === 'zoom' && (
        <div className="pfx-body">
          <div className="pfx-hint">Наведи мышкой на плитку — увидишь как двигается. Кликни — выбрать.</div>
          <div className="pfx-tiles" style={{ '--kb-scale': 1 + intensity, '--shake-amp': `${shake * 0.4}px`, '--shake-on': shake > 0 ? 1 : 0 }}>
            {scope === 'scene' && (
              <button className={`fx-tile ${!local.zoom ? 'selected' : ''}`}
                onClick={() => patchScene({ zoom: undefined })}>
                <div className="fx-frame pfx-auto-frame">Авто</div>
                <span className="fx-tile-label">Авто (рандом)</span>
                {!local.zoom && <span className="fx-check">✓</span>}
              </button>
            )}
            {ZOOM_PRESETS.map(p => {
              const isActive = scope === 'scene'
                ? local.zoom === p.id
                : (project.zoomPresets || []).includes(p.id);
              return (
                <button key={p.id}
                  className={`fx-tile ${isActive ? 'selected' : ''}`}
                  onClick={() => {
                    if (scope === 'scene') {
                      setZoomPreset(p.id);
                    } else {
                      const list = project.zoomPresets || [];
                      const next = list.includes(p.id) ? list.filter(x => x !== p.id) : [...list, p.id];
                      if (next.length === 0) return;
                      patchProject({ zoomPresets: next });
                    }
                  }}>
                  <div className="fx-frame">
                    <div className={`fx-img kb-${p.id}`} style={{ backgroundImage: `url(${sampleA})` }} />
                  </div>
                  <span className="fx-tile-label">{p.label}</span>
                  {isActive && <span className="fx-check">✓</span>}
                </button>
              );
            })}
          </div>

          <div className="pfx-controls">
            <label className="pfx-slider">
              <span>Сила движения: <b>{Math.round(intensity * 100)}%</b></span>
              <input type="range" min="0.05" max="0.35" step="0.01" value={intensity}
                onChange={e => setVal({ zoomIntensity: +e.target.value })} />
            </label>
            <label className="pfx-slider">
              <span>Скорость: <b>{speed.toFixed(1)}x</b></span>
              <input type="range" min="0.5" max="2.0" step="0.1" value={speed}
                onChange={e => setVal({ speed: +e.target.value })} />
            </label>
            <label className="pfx-slider">
              <span>Плавность</span>
              <select value={easing} onChange={e => setVal({ easing: e.target.value })}>
                <option value="linear">Линейный</option>
                <option value="easeIn">Плавный старт</option>
                <option value="easeOut">Плавный конец</option>
                <option value="easeInOut">Плавный с обеих сторон</option>
              </select>
            </label>
            <label className="pfx-slider">
              <span>📳 Дрожание камеры: <b>{shake === 0 ? 'выкл' : shake.toFixed(1)}</b></span>
              <input type="range" min="0" max="20" step="0.5" value={shake}
                onChange={e => setVal({ cameraShake: +e.target.value })} />
            </label>
          </div>

          {scope === 'scene' && (
            <div className="pfx-focus-block">
              <div className="pfx-focus-info">
                <div className="pfx-focus-title">📍 Точка фокуса камеры</div>
                <div className="pfx-hint">Кликни на картинку — туда будет смотреть камера</div>
                <div>Сейчас: X={focusX}%, Y={focusY}%</div>
                <button className="btn-sm" onClick={() => patchScene({ focusX: undefined, focusY: undefined })}>
                  ⊙ В центр
                </button>
              </div>
              <div className={`pfx-focus-pad ${shake > 0 ? 'shake-on' : ''}`} style={{ '--shake-amp': `${shake * 0.4}px` }} onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
                patchScene({ focusX: x, focusY: y });
              }}>
                {scene.imagePath && <img src={sampleA} alt="" />}
                <div className="focus-marker" style={{ left: `${focusX}%`, top: `${focusY}%` }} />
              </div>
            </div>
          )}

          {scope === 'scene' && (
            <label className="pfx-checkbox">
              <input type="checkbox" checked={!!local.disableZoom}
                onChange={e => patchScene({ disableZoom: e.target.checked || undefined })} />
              Отключить зум на этой сцене
            </label>
          )}
        </div>
      )}

      {tab === 'trans' && (
        <div className="pfx-body">
          {scope === 'scene' && safeIndex >= scenes.length - 1 ? (
            <div className="pfx-hint">Это последняя сцена — переход после неё не нужен.</div>
          ) : (
            <>
              <div className="pfx-hint">Наведи на плитку — посмотри как сцена А переходит в Б.</div>
              <div className="pfx-tiles" style={{ '--tr-dur': `${transDur}s` }}>
                {scope === 'scene' && (
                  <button className={`fx-tile ${!local.transition ? 'selected' : ''}`}
                    onClick={() => patchScene({ transition: undefined })}>
                    <div className="fx-frame pfx-auto-frame">Авто</div>
                    <span className="fx-tile-label">Авто (рандом)</span>
                    {!local.transition && <span className="fx-check">✓</span>}
                  </button>
                )}
                {transitions.map(t => {
                  const isActive = scope === 'scene'
                    ? local.transition === t.id
                    : (project.transitionPresets || []).includes(t.id);
                  return (
                    <button key={t.id}
                      className={`fx-tile ${isActive ? 'selected' : ''}`}
                      onClick={() => {
                        if (scope === 'scene') {
                          setTransPreset(t.id);
                        } else {
                          const list = project.transitionPresets || [];
                          const next = list.includes(t.id) ? list.filter(x => x !== t.id) : [...list, t.id];
                          if (next.length === 0) return;
                          patchProject({ transitionPresets: next });
                        }
                      }}>
                      <div className="fx-frame">
                        <div className="fx-img" style={{ backgroundImage: `url(${sampleA})` }} />
                        <div className={`fx-img fx-imgB tr-${t.id}`} style={{ backgroundImage: `url(${sampleB})` }} />
                      </div>
                      <span className="fx-tile-label">{t.label}</span>
                      {isActive && <span className="fx-check">✓</span>}
                    </button>
                  );
                })}
              </div>

              <div className="pfx-controls">
                <label className="pfx-slider">
                  <span>Длительность перехода: <b>{transDur.toFixed(1)}с</b></span>
                  <input type="range" min="0.2" max="1.5" step="0.1" value={transDur}
                    onChange={e => setVal({ transitionDuration: +e.target.value })} />
                </label>
              </div>

              {scope === 'scene' && (
                <label className="pfx-checkbox">
                  <input type="checkbox" checked={!!local.disableTransition}
                    onChange={e => patchScene({ disableTransition: e.target.checked || undefined })} />
                  Без перехода после этой сцены
                </label>
              )}
            </>
          )}
        </div>
      )}

      <div className="pfx-footer">
        <button className="btn-primary" onClick={onRenderPreview}>
          🔄 Применить и пересобрать превью
        </button>
        {scope === 'scene' && (local.zoom || local.transition || local.zoomIntensity != null || local.speed != null || local.easing || local.focusX != null || local.disableZoom || local.disableTransition) && (
          <button className="btn-sm" onClick={() => { setLocal({}); onPatchScene(scene.id, null); }}>
            Сбросить настройки сцены
          </button>
        )}
      </div>
    </div>
  );
}
