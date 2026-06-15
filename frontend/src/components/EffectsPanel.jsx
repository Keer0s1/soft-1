// Панель эффектов: качество, зум (Ken Burns) и переходы.
// Превью — на CSS: анимируются ТОЛЬКО при наведении мышкой и сразу отражают
// текущие настройки (силу зума / длительность перехода). Показываются на твоей
// картинке (первые сцены), иначе на образце.

function ZoomTile({ preset, selected, onToggle, intensity, sample }) {
  return (
    <button
      type="button"
      className={`fx-tile${selected ? ' selected' : ''}`}
      style={{ '--kb-scale': 1 + intensity }}
      onClick={onToggle}
      title="Навести — посмотреть; клик — выбрать"
    >
      <div className="fx-frame">
        <div className={`fx-img kb-${preset.id}`} style={{ backgroundImage: `url(${sample})` }} />
      </div>
      <span className="fx-tile-label">{preset.label}</span>
      {selected && <span className="fx-check">✓</span>}
    </button>
  );
}

function TransTile({ preset, selected, onToggle, duration, sampleA, sampleB }) {
  return (
    <button
      type="button"
      className={`fx-tile${selected ? ' selected' : ''}`}
      style={{ '--tr-dur': `${duration}s` }}
      onClick={onToggle}
      title="Навести — посмотреть; клик — выбрать"
    >
      <div className="fx-frame">
        <div className="fx-img" style={{ backgroundImage: `url(${sampleA})` }} />
        <div className={`fx-img fx-imgB tr-${preset.id}`} style={{ backgroundImage: `url(${sampleB})` }} />
      </div>
      <span className="fx-tile-label">{preset.label}</span>
      {selected && <span className="fx-check">✓</span>}
    </button>
  );
}

export default function EffectsPanel({ project, effects, onPatch, sampleA, sampleB }) {
  if (!effects) return null;
  const A = sampleA || '/examples/sample1.jpg';
  const B = sampleB || '/examples/sample2.jpg';
  const zoomPresets = project.zoomPresets ?? [];
  const transPresets = project.transitionPresets ?? [];

  const toggle = (field, current, id) => {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    if (next.length === 0) return; // хотя бы один остаётся
    onPatch({ [field]: next });
  };

  return (
    <details className="panel fx-panel">
      <summary>🎬 Эффекты — зум и переходы <span className="muted small">(не обязательно)</span></summary>

      <div className="fx-row">
        <label className="fx-quality">
          Качество / скорость рендера
          <select value={project.renderQuality} onChange={(e) => onPatch({ renderQuality: e.target.value })}>
            {effects.qualities.map((q) => (
              <option key={q.id} value={q.id}>{q.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Зум / движение */}
      <div className={`fx-section${project.zoomEnabled ? '' : ' off'}`}>
        <div className="fx-head">
          <label className="fx-toggle">
            <input type="checkbox" checked={project.zoomEnabled} onChange={(e) => onPatch({ zoomEnabled: e.target.checked })} />
            <b>Зум / движение (Ken Burns)</b>
          </label>
          {project.zoomEnabled && (
            <label className="fx-slider">
              Сила: {Math.round(project.zoomIntensity * 100)}%
              <input type="range" min="0.05" max="0.35" step="0.01" value={project.zoomIntensity}
                onChange={(e) => onPatch({ zoomIntensity: Number(e.target.value) })} />
            </label>
          )}
        </div>
        {project.zoomEnabled && (
          <>
            <div className="muted small">Наведи на пример, чтобы увидеть. Выбранные ставятся по сценам в случайном порядке.</div>
            <div className="fx-grid">
              {effects.zoom.map((z) => (
                <ZoomTile key={z.id} preset={z} sample={A} intensity={project.zoomIntensity}
                  selected={zoomPresets.includes(z.id)} onToggle={() => toggle('zoomPresets', zoomPresets, z.id)} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Переходы */}
      <div className={`fx-section${project.transitionEnabled ? '' : ' off'}`}>
        <div className="fx-head">
          <label className="fx-toggle">
            <input type="checkbox" checked={project.transitionEnabled} onChange={(e) => onPatch({ transitionEnabled: e.target.checked })} />
            <b>Переходы между сценами</b>
          </label>
          {project.transitionEnabled && (
            <label className="fx-slider">
              Длительность: {project.transitionDuration.toFixed(1)}с
              <input type="range" min="0.2" max="1.5" step="0.1" value={project.transitionDuration}
                onChange={(e) => onPatch({ transitionDuration: Number(e.target.value) })} />
            </label>
          )}
        </div>
        {project.transitionEnabled && (
          <>
            <div className="muted small">Наведи на пример, чтобы увидеть. Выбранные чередуются в случайном порядке.</div>
            <div className="fx-grid">
              {effects.transitions.map((t) => (
                <TransTile key={t.id} preset={t} sampleA={A} sampleB={B} duration={project.transitionDuration}
                  selected={transPresets.includes(t.id)} onToggle={() => toggle('transitionPresets', transPresets, t.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
