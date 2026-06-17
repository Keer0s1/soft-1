import { useState, useMemo } from 'react';

const STYLES = [
  { id: 'modern', label: 'Modern', font: 'Arial, sans-serif', weight: 700 },
  { id: 'classic', label: 'Classic', font: 'Times New Roman, serif', weight: 400 },
  { id: 'bold', label: 'Bold', font: 'Impact, sans-serif', weight: 800 },
  { id: 'minimal', label: 'Minimal', font: 'Arial, sans-serif', weight: 400 },
];

export default function SubtitlesPanel({ project, onPatch }) {
  const [open, setOpen] = useState(true);
  if (!project.subtitlesEnabled) return null;

  const mode = project.subtitlesMode ?? 'karaoke';

  return (
    <div className="subs-panel">
      <div className="subs-panel-head" onClick={() => setOpen(o => !o)}>
        <span className="subs-panel-title">Субтитры</span>
        <span className="subs-panel-toggle">{open ? '▾' : '▸'}</span>
      </div>
      {open && <div className="subs-panel-body">
        {/* Режим показа */}
        <div className="subs-section">
          <span className="subs-section-title">Режим показа</span>
          <div className="subs-mode-row">
            <button className={`subs-mode-btn${mode === 'karaoke' ? ' active' : ''}`}
              onClick={() => onPatch({ subtitlesMode: 'karaoke' })}>
              <span className="subs-mode-demo">
                <span className="smd-dim">Каждое </span>
                <span className="smd-hi">слово</span>
                <span className="smd-dim"> подсвечивается</span>
              </span>
              <span className="subs-mode-label">По словам</span>
            </button>
            <button className={`subs-mode-btn${mode === 'phrase' ? ' active' : ''}`}
              onClick={() => onPatch({ subtitlesMode: 'phrase' })}>
              <span className="subs-mode-demo">
                <span className="smd-all">Фраза целиком</span>
              </span>
              <span className="subs-mode-label">Целая фраза</span>
            </button>
          </div>
        </div>

        {/* Появление фразы (только для режима phrase) */}
        {mode === 'phrase' && <div className="subs-section">
          <span className="subs-section-title">Появление фразы</span>
          <div className="subs-tiles">
            {[{id:'fade',l:'Плавно'},{id:'slideUp',l:'Снизу'},{id:'scale',l:'Зум'},{id:'typewriter',l:'Печать'}].map(a => (
              <button key={a.id} className={`sub-tile${(project.subtitlesAnimation ?? 'fade') === a.id ? ' sub-tile-active' : ''}`} onClick={() => onPatch({ subtitlesAnimation: a.id })}>
                <span className={`sub-tile-preview sub-anim-demo-${a.id}`}>Аа</span>
                <span className="sub-tile-label">{a.l}</span>
              </button>
            ))}
          </div>
        </div>}

        {/* Стиль */}
        <div className="subs-section">
          <span className="subs-section-title">Шрифт</span>
          <div className="subs-tiles">
            {STYLES.map(s => (
              <button key={s.id} className={`sub-tile${(project.subtitlesStyle ?? 'modern') === s.id ? ' sub-tile-active' : ''}`} onClick={() => onPatch({ subtitlesStyle: s.id })}>
                <span className="sub-tile-preview" style={{ fontFamily: s.font, fontWeight: s.weight }}>Аа</span>
                <span className="sub-tile-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Компактные настройки в одну строку */}
        <div className="subs-compact">
          <label className="subs-sl">
            <span>{project.subtitlesFontSize ?? 48}px</span>
            <input type="range" min="24" max="96" step="2" value={project.subtitlesFontSize ?? 48} onChange={(e) => onPatch({ subtitlesFontSize: Number(e.target.value) })} />
          </label>
          <label className="subs-sl">
            <span>Обводка {project.subtitlesOutline ?? 3}</span>
            <input type="range" min="0" max="8" step="0.5" value={project.subtitlesOutline ?? 3} onChange={(e) => onPatch({ subtitlesOutline: Number(e.target.value) })} />
          </label>
          <label className="subs-sl">
            <span>Промежуток {project.subtitlesSpacing ?? 4}px</span>
            <input type="range" min="0" max="30" step="1" value={project.subtitlesSpacing ?? 4} onChange={(e) => onPatch({ subtitlesSpacing: Number(e.target.value) })} />
          </label>
          <label className="subs-sl">
            <span>X {project.subtitlesX ?? 50}%</span>
            <input type="range" min="10" max="90" value={project.subtitlesX ?? 50} onChange={(e) => onPatch({ subtitlesX: Number(e.target.value) })} />
          </label>
          <label className="subs-sl">
            <span>Y {project.subtitlesY ?? 85}%</span>
            <input type="range" min="10" max="95" value={project.subtitlesY ?? 85} onChange={(e) => onPatch({ subtitlesY: Number(e.target.value) })} />
          </label>
          <input type="color" value={project.subtitlesColor ?? '#FFFFFF'} onChange={(e) => onPatch({ subtitlesColor: e.target.value })} title="Цвет текста" className="subs-color" />
          <input type="color" value={project.subtitlesOutlineColor ?? '#000000'} onChange={(e) => onPatch({ subtitlesOutlineColor: e.target.value })} title="Обводка" className="subs-color" />
          <label className="fx-toggle" style={{ fontSize: 11 }}>
            <input type="checkbox" checked={project.subtitlesBgEnabled ?? false} onChange={(e) => onPatch({ subtitlesBgEnabled: e.target.checked })} />
            Фон
          </label>
        </div>
      </div>}
    </div>
  );
}