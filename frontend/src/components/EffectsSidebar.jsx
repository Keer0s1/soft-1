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

export default function EffectsSidebar({
  scene, sceneIndex, scenes, project, effects, resolvedPreset,
  onPatchScene, onClose, onRenderPreview,
}) {
  const ov = scene.effectOverrides || {};
  const [tab, setTab] = useState('zoom');
  const [local, setLocal] = useState({ ...ov });
  const debounceRef = useRef(null);

  useEffect(() => {
    setLocal({ ...(scene.effectOverrides || {}) });
  }, [scene.id]);

  const flush = useCallback((next) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onPatchScene(next);
    }, 350);
  }, [onPatchScene]);

  const patch = useCallback((changes) => {
    const next = { ...local };
    for (const k of Object.keys(changes)) {
      if (changes[k] === undefined) delete next[k];
      else next[k] = changes[k];
    }
    setLocal(next);
    flush(next);
  }, [local, flush]);

  const intensity = local.zoomIntensity ?? project.zoomIntensity ?? 0.15;
  const speed = local.speed ?? project.zoomSpeed ?? 1.0;
  const easing = local.easing ?? project.zoomEasing ?? 'linear';
  const focusX = local.focusX ?? 50;
  const focusY = local.focusY ?? 50;
  const transDur = local.transitionDuration ?? project.transitionDuration ?? 0.5;

  const sampleA = scene.imagePath ? `/files/${scene.imagePath}` : '/examples/sample1.jpg';
  const nextScene = scenes && scenes[sceneIndex + 1];
  const sampleB = nextScene?.imagePath ? `/files/${nextScene.imagePath}` : '/examples/sample2.jpg';

  const transitions = effects?.transitions || [];

  return (
    <aside className="effects-sidebar">
      <div className="sidebar-header">
        <h3>Сцена {sceneIndex + 1}</h3>
        <button className="btn-icon" onClick={onClose} title="Закрыть">✕</button>
      </div>

      <div className="sidebar-tabs">
        <button className={`sidebar-tab ${tab === 'zoom' ? 'active' : ''}`} onClick={() => setTab('zoom')}>
          🎬 Эффект (зум)
        </button>
        <button className={`sidebar-tab ${tab === 'trans' ? 'active' : ''}`} onClick={() => setTab('trans')}>
          ↔ Переход
        </button>
      </div>

      {tab === 'zoom' && (
        <>
          <div className="sidebar-hint">Наведи на плитку — увидишь как двигается. Кликни — выбрать.</div>

          <div className="sidebar-tiles" style={{ '--kb-scale': 1 + intensity * speed }}>
            <button
              className={`fx-tile ${!local.zoom ? 'selected' : ''}`}
              onClick={() => patch({ zoom: undefined })}
              title="Авто — выбирается случайно из настроек проекта"
            >
              <div className="fx-frame" style={{ background: 'linear-gradient(135deg, #2a2f3a, #181b22)' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--muted)', fontSize:11 }}>
                  Авто
                </div>
              </div>
              <span className="fx-tile-label">Авто</span>
              {!local.zoom && <span className="fx-check">✓</span>}
            </button>
            {ZOOM_PRESETS.map(p => (
              <button
                key={p.id}
                className={`fx-tile ${local.zoom === p.id ? 'selected' : ''}`}
                onClick={() => patch({ zoom: p.id })}
                title="Навести — посмотреть; клик — выбрать"
              >
                <div className="fx-frame">
                  <div className={`fx-img kb-${p.id}`} style={{ backgroundImage: `url(${sampleA})` }} />
                </div>
                <span className="fx-tile-label">{p.label}</span>
                {local.zoom === p.id && <span className="fx-check">✓</span>}
              </button>
            ))}
          </div>

          <div className="sidebar-section">
            <label className="sidebar-label">
              Сила движения: {Math.round(intensity * 100)}%
            </label>
            <input type="range" min="0.05" max="0.35" step="0.01" value={intensity}
              onChange={e => patch({ zoomIntensity: +e.target.value })} />
          </div>

          <div className="sidebar-section">
            <label className="sidebar-label">
              Скорость: {speed.toFixed(1)}x
            </label>
            <input type="range" min="0.5" max="2.0" step="0.1" value={speed}
              onChange={e => patch({ speed: +e.target.value })} />
          </div>

          <div className="sidebar-section">
            <label className="sidebar-label">Плавность</label>
            <select value={easing} onChange={e => patch({ easing: e.target.value })}>
              <option value="linear">Линейный (равномерно)</option>
              <option value="easeIn">Плавный старт</option>
              <option value="easeOut">Плавный конец</option>
              <option value="easeInOut">Плавный с обеих сторон</option>
            </select>
          </div>

          <div className="sidebar-section">
            <label className="sidebar-label">
              Точка фокуса: X={focusX}%, Y={focusY}%
            </label>
            <div className="focus-pad" onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
              const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
              patch({ focusX: x, focusY: y });
            }}>
              {scene.imagePath && <img src={sampleA} alt="" />}
              <div className="focus-marker" style={{ left: `${focusX}%`, top: `${focusY}%` }} />
            </div>
            <div className="sidebar-hint">Кликни на картинку — куда камера будет смотреть</div>
            <button className="btn-sm" onClick={() => patch({ focusX: undefined, focusY: undefined })}>
              ⊙ Сбросить в центр
            </button>
          </div>

          <div className="sidebar-section">
            <label className="sidebar-label">
              <input type="checkbox" checked={!!local.disableZoom}
                onChange={e => patch({ disableZoom: e.target.checked || undefined })}
              /> Отключить зум на этой сцене
            </label>
          </div>
        </>
      )}

      {tab === 'trans' && (
        <>
          {sceneIndex >= scenes.length - 1 ? (
            <div className="sidebar-hint">Это последняя сцена — переход после неё не нужен.</div>
          ) : (
            <>
              <div className="sidebar-hint">Переход с этой сцены на следующую. Наведи на плитку — посмотри.</div>

              <div className="sidebar-tiles" style={{ '--tr-dur': `${transDur}s` }}>
                <button
                  className={`fx-tile ${!local.transition ? 'selected' : ''}`}
                  onClick={() => patch({ transition: undefined })}
                >
                  <div className="fx-frame" style={{ background: 'linear-gradient(135deg, #2a2f3a, #181b22)' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--muted)', fontSize:11 }}>
                      Авто
                    </div>
                  </div>
                  <span className="fx-tile-label">Авто</span>
                  {!local.transition && <span className="fx-check">✓</span>}
                </button>
                {transitions.map(t => (
                  <button
                    key={t.id}
                    className={`fx-tile ${local.transition === t.id ? 'selected' : ''}`}
                    onClick={() => patch({ transition: t.id })}
                  >
                    <div className="fx-frame">
                      <div className="fx-img" style={{ backgroundImage: `url(${sampleA})` }} />
                      <div className={`fx-img fx-imgB tr-${t.id}`} style={{ backgroundImage: `url(${sampleB})` }} />
                    </div>
                    <span className="fx-tile-label">{t.label}</span>
                    {local.transition === t.id && <span className="fx-check">✓</span>}
                  </button>
                ))}
              </div>

              <div className="sidebar-section">
                <label className="sidebar-label">
                  Длительность перехода: {transDur.toFixed(1)}с
                </label>
                <input type="range" min="0.2" max="1.5" step="0.1" value={transDur}
                  onChange={e => patch({ transitionDuration: +e.target.value })} />
              </div>

              <div className="sidebar-section">
                <label className="sidebar-label">
                  <input type="checkbox" checked={!!local.disableTransition}
                    onChange={e => patch({ disableTransition: e.target.checked || undefined })}
                  /> Без перехода после этой сцены
                </label>
              </div>
            </>
          )}
        </>
      )}

      <div className="sidebar-footer">
        <button className="btn-primary" onClick={onRenderPreview}>
          🔄 Применить и собрать превью
        </button>
        <button className="btn-sm" onClick={() => { setLocal({}); onPatchScene({}); }}>
          Сбросить настройки сцены
        </button>
      </div>
    </aside>
  );
}
