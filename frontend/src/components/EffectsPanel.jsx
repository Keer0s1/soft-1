// Панель эффектов: качество, зум (Ken Burns) и переходы.
// Превью — на CSS: анимируются ТОЛЬКО при наведении мышкой и сразу отражают
// текущие настройки (силу зума / длительность перехода). Показываются на твоей
// картинке (первые сцены), иначе на образце.

import { useRef } from 'react';
import GradingPreview from './GradingPreview.jsx';

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

export default function EffectsPanel({ project, effects, onPatch, sampleA, sampleB, luts, musicList, scenes, projectId, onMusicUploaded }) {
  const musicFileRef = useRef(null);
  if (!effects) return null;
  const A = sampleA || '/examples/sample1.jpg';
  const B = sampleB || '/examples/sample2.jpg';
  const zoomPresets = project.zoomPresets ?? [];
  const transPresets = project.transitionPresets ?? [];
  const sampleText = scenes?.[0]?.voiceText || 'Пример текста субтитров';

  function handleMusicFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onMusicUploaded?.(ev.target.result);
    };
    reader.readAsDataURL(file);
  }

  const toggle = (field, current, id) => {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    if (next.length === 0) return; // хотя бы один остаётся
    onPatch({ [field]: next });
  };

  return (
    <details className="panel fx-panel">
      <summary>
        <span>Тонкая настройка</span>
        <span className="fx-summary-meta">
          качество: <b>{effects.qualities.find(q => q.id === project.renderQuality)?.label || project.renderQuality}</b>
        </span>
      </summary>

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
            <>
            <label className="fx-slider">
              Сила: {Math.round(project.zoomIntensity * 100)}%
              <input type="range" min="0.05" max="0.35" step="0.01" value={project.zoomIntensity}
                onChange={(e) => onPatch({ zoomIntensity: Number(e.target.value) })} />
            </label>
            <label className="fx-slider">
              Скорость: {(project.zoomSpeed ?? 1.0).toFixed(1)}x
              <input type="range" min="0.5" max="2.0" step="0.1" value={project.zoomSpeed ?? 1.0}
                onChange={(e) => onPatch({ zoomSpeed: Number(e.target.value) })} />
            </label>
            <label className="fx-slider">
              Плавность:
              <select value={project.zoomEasing ?? 'linear'} onChange={(e) => onPatch({ zoomEasing: e.target.value })} style={{ marginLeft: 8 }}>
                <option value="linear">Линейный</option>
                <option value="easeIn">Плавный старт</option>
                <option value="easeOut">Плавный конец</option>
                <option value="easeInOut">Плавный</option>
              </select>
            </label>
            </>
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

      {/* Цветокоррекция */}
      <div className="fx-section">
        <div className="fx-head">
          <b>🎨 Цветокоррекция и субтитры</b>
        </div>

        {/* Live Preview */}
        <GradingPreview
          project={project}
          sampleImage={A}
          sampleText={sampleText}
          onPatch={onPatch}
        />
        <div className="fx-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 10 }}>
          <label className="fx-toggle">
            <input type="checkbox" checked={project.grainEnabled ?? false} onChange={(e) => onPatch({ grainEnabled: e.target.checked })} />
            Зернистость (film grain)
          </label>
          {project.grainEnabled && (
            <label className="fx-slider">
              Сила: {Math.round(project.grainIntensity ?? 8)}
              <input type="range" min="1" max="25" step="1" value={project.grainIntensity ?? 8}
                onChange={(e) => onPatch({ grainIntensity: Number(e.target.value) })} />
            </label>
          )}
        </div>
        <div className="fx-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 8 }}>
          <label className="fx-toggle">
            <input type="checkbox" checked={project.vignetteEnabled ?? false} onChange={(e) => onPatch({ vignetteEnabled: e.target.checked })} />
            Виньетка (затемнение краёв)
          </label>
          {project.vignetteEnabled && (
            <label className="fx-slider">
              Сила: {Math.round((project.vignetteIntensity ?? 0.5) * 100)}%
              <input type="range" min="0.1" max="1.0" step="0.05" value={project.vignetteIntensity ?? 0.5}
                onChange={(e) => onPatch({ vignetteIntensity: Number(e.target.value) })} />
            </label>
          )}
        </div>
        {luts && luts.length > 0 && (
          <div className="fx-row" style={{ marginTop: 10 }}>
            <label>
              LUT (цветовой стиль)
              <select value={project.lutFile ?? ''} onChange={(e) => onPatch({ lutFile: e.target.value || null })}>
                <option value="">Без LUT</option>
                {luts.map((l) => (
                  <option key={l.file} value={l.file}>{l.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Цветокоррекция */}
        <div className="fx-row fx-cc-grid" style={{ marginTop: 14 }}>
          <div>
            <div className="cc-label">☀ Яркость</div>
            <div className="cc-row">
              <input type="range" min="-100" max="100" step="1" value={project.ccBrightness ?? 0}
                onChange={(e) => onPatch({ ccBrightness: Number(e.target.value) })} />
              <input type="number" className="cc-num" min="-100" max="100" value={project.ccBrightness ?? 0}
                onChange={(e) => onPatch({ ccBrightness: Math.min(100, Math.max(-100, Number(e.target.value) || 0)) })} />
            </div>
          </div>
          <div>
            <div className="cc-label">◐ Контраст</div>
            <div className="cc-row">
              <input type="range" min="-100" max="100" step="1" value={project.ccContrast ?? 0}
                onChange={(e) => onPatch({ ccContrast: Number(e.target.value) })} />
              <input type="number" className="cc-num" min="-100" max="100" value={project.ccContrast ?? 0}
                onChange={(e) => onPatch({ ccContrast: Math.min(100, Math.max(-100, Number(e.target.value) || 0)) })} />
            </div>
          </div>
          <div>
            <div className="cc-label">◑ Насыщенность</div>
            <div className="cc-row">
              <input type="range" min="-100" max="100" step="1" value={project.ccSaturation ?? 0}
                onChange={(e) => onPatch({ ccSaturation: Number(e.target.value) })} />
              <input type="number" className="cc-num" min="-100" max="100" value={project.ccSaturation ?? 0}
                onChange={(e) => onPatch({ ccSaturation: Math.min(100, Math.max(-100, Number(e.target.value) || 0)) })} />
            </div>
          </div>
          <div>
            <div className="cc-label">🌡 Температура</div>
            <div className="cc-row">
              <input type="range" min="-100" max="100" step="1" value={project.ccTemperature ?? 0}
                onChange={(e) => onPatch({ ccTemperature: Number(e.target.value) })} />
              <input type="number" className="cc-num" min="-100" max="100" value={project.ccTemperature ?? 0}
                onChange={(e) => onPatch({ ccTemperature: Math.min(100, Math.max(-100, Number(e.target.value) || 0)) })} />
            </div>
          </div>
          {(project.ccBrightness || project.ccContrast || project.ccSaturation || project.ccTemperature) ? (
            <button type="button" className="ghost small" style={{ marginTop: 4 }}
              onClick={() => onPatch({ ccBrightness: 0, ccContrast: 0, ccSaturation: 0, ccTemperature: 0 })}>
              Сбросить цветокоррекцию
            </button>
          ) : null}
        </div>
      </div>

      {/* Фоновая музыка */}
      <div className="fx-section">
        <div className="fx-head">
          <b>🎵 Фоновая музыка</b>
        </div>
        <div className="fx-row" style={{ display: 'flex', gap: 10, alignItems: 'end', marginTop: 10, flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: 180 }}>
            Трек
            <select value={project.bgMusicPath ?? ''} onChange={(e) => onPatch({ bgMusicPath: e.target.value || null })}>
              <option value="">Без музыки</option>
              {(musicList ?? []).map((m) => (
                <option key={m.path} value={m.path}>{m.name}</option>
              ))}
              {project.bgMusicPath && !(musicList ?? []).find((m) => m.path === project.bgMusicPath) && (
                <option value={project.bgMusicPath}>Загруженный трек</option>
              )}
            </select>
          </label>
          <button type="button" className="ghost small" onClick={() => musicFileRef.current?.click()}>
            ⬆ Загрузить mp3
          </button>
          <input ref={musicFileRef} type="file" accept="audio/*" hidden onChange={handleMusicFile} />
        </div>
        {project.bgMusicPath && (
          <div className="fx-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 8 }}>
            <label className="fx-slider">
              Громкость: {Math.round((project.bgMusicVolume ?? 0.15) * 100)}%
              <input type="range" min="0.02" max="0.5" step="0.01" value={project.bgMusicVolume ?? 0.15}
                onChange={(e) => onPatch({ bgMusicVolume: Number(e.target.value) })} />
            </label>
            <label className="fx-toggle">
              <input type="checkbox" checked={project.bgMusicDucking ?? true} onChange={(e) => onPatch({ bgMusicDucking: e.target.checked })} />
              Auto-ducking (глушить при голосе)
            </label>
          </div>
        )}
      </div>

      {/* Субтитры */}
      <div className="fx-section">
        <div className="fx-head">
          <label className="fx-toggle">
            <input type="checkbox" checked={project.subtitlesEnabled ?? false} onChange={(e) => onPatch({ subtitlesEnabled: e.target.checked })} />
            <b>💬 Субтитры</b>
          </label>
        </div>
        {project.subtitlesEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[{ id: 'modern', label: 'Modern', font: 'Arial, sans-serif' }, { id: 'classic', label: 'Classic', font: 'Times New Roman, serif' }, { id: 'bold', label: 'Bold', font: 'Impact, sans-serif' }, { id: 'minimal', label: 'Minimal', font: 'Arial, sans-serif' }].map(s => (
                <button key={s.id} className={`sub-tile${(project.subtitlesStyle ?? 'modern') === s.id ? ' sub-tile-active' : ''}`} onClick={() => onPatch({ subtitlesStyle: s.id })}>
                  <span className="sub-tile-preview" style={{ fontFamily: s.font, fontWeight: s.id === 'bold' ? 800 : s.id === 'modern' ? 700 : 400 }}>Привет</span>
                  <span className="sub-tile-label">{s.label}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[{ id: 'fade', label: 'Fade' }, { id: 'slideUp', label: 'Slide' }, { id: 'scale', label: 'Scale' }, { id: 'typewriter', label: 'Typewriter' }].map(a => (
                <button key={a.id} className={`sub-tile${(project.subtitlesAnimation ?? 'fade') === a.id ? ' sub-tile-active' : ''}`} onClick={() => onPatch({ subtitlesAnimation: a.id })}>
                  <span className={`sub-tile-preview sub-anim-demo-${a.id}`}>Текст</span>
                  <span className="sub-tile-label">{a.label}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="fx-slider" style={{ minWidth: 140 }}>
                Размер: {project.subtitlesFontSize ?? 48}px
                <input type="range" min="24" max="96" step="2" value={project.subtitlesFontSize ?? 48}
                  onChange={(e) => onPatch({ subtitlesFontSize: Number(e.target.value) })} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Цвет текста
                <input type="color" value={project.subtitlesColor ?? '#FFFFFF'} onChange={(e) => onPatch({ subtitlesColor: e.target.value })} style={{ width: 36, height: 30, padding: 0, border: 'none' }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Обводка
                <input type="color" value={project.subtitlesOutlineColor ?? '#000000'} onChange={(e) => onPatch({ subtitlesOutlineColor: e.target.value })} style={{ width: 36, height: 30, padding: 0, border: 'none' }} />
              </label>
              <label className="fx-slider" style={{ minWidth: 120 }}>
                Толщина: {project.subtitlesOutline ?? 3}
                <input type="range" min="0" max="8" step="0.5" value={project.subtitlesOutline ?? 3}
                  onChange={(e) => onPatch({ subtitlesOutline: Number(e.target.value) })} />
              </label>
              <label className="fx-slider" style={{ minWidth: 120 }}>
                Тень: {project.subtitlesShadow ?? 2}
                <input type="range" min="0" max="5" step="0.5" value={project.subtitlesShadow ?? 2}
                  onChange={(e) => onPatch({ subtitlesShadow: Number(e.target.value) })} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="fx-toggle">
                <input type="checkbox" checked={project.subtitlesBgEnabled ?? false} onChange={(e) => onPatch({ subtitlesBgEnabled: e.target.checked })} />
                Фон-подложка
              </label>
              {project.subtitlesBgEnabled && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Цвет фона
                    <input type="color" value={project.subtitlesBgColor ?? '#000000'} onChange={(e) => onPatch({ subtitlesBgColor: e.target.value })} style={{ width: 36, height: 30, padding: 0, border: 'none' }} />
                  </label>
                  <label className="fx-slider" style={{ minWidth: 130 }}>
                    Прозрачность: {Math.round((project.subtitlesBgOpacity ?? 0.5) * 100)}%
                    <input type="range" min="0.1" max="1" step="0.05" value={project.subtitlesBgOpacity ?? 0.5}
                      onChange={(e) => onPatch({ subtitlesBgOpacity: Number(e.target.value) })} />
                  </label>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
