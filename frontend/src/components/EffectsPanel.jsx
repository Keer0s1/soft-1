// Панель настроек эффектов: качество, зум (Ken Burns) и переходы.
// У каждого пресета — живой мини-пример (видео), чтобы было видно, как двигается.

function PresetTile({ preset, selected, onToggle }) {
  return (
    <button
      type="button"
      className={`fx-tile${selected ? ' selected' : ''}`}
      onClick={onToggle}
      title={preset.label}
    >
      <video src={preset.example} muted loop autoPlay playsInline />
      <span className="fx-tile-label">{preset.label}</span>
      {selected && <span className="fx-check">✓</span>}
    </button>
  );
}

export default function EffectsPanel({ project, effects, onPatch }) {
  if (!effects) return null;
  const zoomPresets = project.zoomPresets ?? [];
  const transPresets = project.transitionPresets ?? [];

  const toggle = (field, current, id) => {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    if (next.length === 0) return; // хотя бы один должен остаться
    onPatch({ [field]: next });
  };

  return (
    <details className="panel fx-panel" open>
      <summary>🎬 Эффекты — зум и переходы</summary>

      <div className="fx-row">
        <label className="fx-quality">
          Качество/скорость рендера
          <select value={project.renderQuality} onChange={(e) => onPatch({ renderQuality: e.target.value })}>
            {effects.qualities.map((q) => (
              <option key={q.id} value={q.id}>{q.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Зум / движение */}
      <div className="fx-section">
        <div className="fx-head">
          <label className="fx-toggle">
            <input type="checkbox" checked={project.zoomEnabled} onChange={(e) => onPatch({ zoomEnabled: e.target.checked })} />
            <b>Зум / движение (Ken Burns)</b>
          </label>
          {project.zoomEnabled && (
            <label className="fx-slider">
              Сила: {Math.round(project.zoomIntensity * 100)}%
              <input
                type="range" min="0.05" max="0.35" step="0.01"
                value={project.zoomIntensity}
                onChange={(e) => onPatch({ zoomIntensity: Number(e.target.value) })}
              />
            </label>
          )}
        </div>
        {project.zoomEnabled && (
          <>
            <div className="muted small">Выбери движения — они будут ставиться по сценам в случайном порядке.</div>
            <div className="fx-grid">
              {effects.zoom.map((z) => (
                <PresetTile key={z.id} preset={z} selected={zoomPresets.includes(z.id)} onToggle={() => toggle('zoomPresets', zoomPresets, z.id)} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Переходы */}
      <div className="fx-section">
        <div className="fx-head">
          <label className="fx-toggle">
            <input type="checkbox" checked={project.transitionEnabled} onChange={(e) => onPatch({ transitionEnabled: e.target.checked })} />
            <b>Переходы между сценами</b>
          </label>
          {project.transitionEnabled && (
            <label className="fx-slider">
              Длительность: {project.transitionDuration.toFixed(1)}с
              <input
                type="range" min="0.2" max="1.5" step="0.1"
                value={project.transitionDuration}
                onChange={(e) => onPatch({ transitionDuration: Number(e.target.value) })}
              />
            </label>
          )}
        </div>
        {project.transitionEnabled && (
          <>
            <div className="muted small">Выбери переходы — они будут чередоваться в случайном порядке.</div>
            <div className="fx-grid">
              {effects.transitions.map((t) => (
                <PresetTile key={t.id} preset={t} selected={transPresets.includes(t.id)} onToggle={() => toggle('transitionPresets', transPresets, t.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
