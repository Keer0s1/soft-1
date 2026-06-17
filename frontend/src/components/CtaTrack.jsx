import { useEffect, useState, useRef } from 'react';
import { api } from '../api.js';

const PRESETS = [
  { text: 'Подпишись!', emoji: '🔔', color: '#FF0000' },
  { text: 'Ставь лайк', emoji: '👍', color: '#2563EB' },
  { text: 'Комментируй', emoji: '💬', color: '#7C3AED' },
  { text: 'Поделись', emoji: '🔗', color: '#059669' },
];
const ANIMATIONS = ['slideIn', 'fadeIn', 'bounce', 'pulse'];

export default function CtaTrack({ projectId, timeline, onChanged }) {
  const { computedTotal, currentTime } = timeline;
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [customText, setCustomText] = useState('');
  const trackRef = useRef(null);

  useEffect(() => { refresh(); }, [projectId]);
  const refresh = () => { api.ctaList(projectId).then(setItems).catch(() => {}); onChanged?.(); };

  const addCta = async (preset) => {
    await api.ctaCreate(projectId, {
      ...preset,
      timeSec: Math.round(currentTime * 100) / 100,
      durationSec: 3,
      x: 75, y: 80, scale: 1.0,
      animation: 'slideIn', style: 'pill',
    });
    refresh();
  };

  const addCustom = async () => {
    if (!customText.trim()) return;
    await api.ctaCreate(projectId, {
      text: customText, emoji: '', color: '#FF6600',
      timeSec: Math.round(currentTime * 100) / 100,
      durationSec: 3,
      x: 50, y: 50, scale: 1.2,
      animation: 'fadeIn', style: 'pill',
    });
    setCustomText('');
    refresh();
  };

  const remove = async (cid) => { await api.ctaRemove(projectId, cid); refresh(); };
  const update = async (cid, data) => { await api.ctaUpdate(projectId, cid, data); refresh(); };

  const uploadOverlay = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*,video/webm,video/mp4,video/mov';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const { path: imgPath } = await api.ctaUploadImage(projectId, ev.target.result, file.name);
        await api.ctaCreate(projectId, {
          text: '', emoji: '', imagePath: imgPath, color: '#00000000',
          timeSec: Math.round(currentTime * 100) / 100,
          durationSec: 4, x: 50, y: 50, scale: 1.0,
          animation: 'fadeIn', style: 'pill',
        });
        refresh();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleDrag = (e, item) => {
    const rect = trackRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const origPct = item.timeSec / computedTotal;
    const el = e.currentTarget;
    const onMove = (ev) => { el.style.left = `${Math.max(0, Math.min(1, origPct + (ev.clientX - startX) / rect.width)) * 100}%`; };
    const onUp = async (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const newPct = Math.max(0, Math.min(1, origPct + (ev.clientX - startX) / rect.width));
      await update(item.id, { timeSec: Math.round(newPct * computedTotal * 100) / 100 });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="cta-section">
      <div className="cta-header">
        <span className="cta-title">CTA</span>
        {PRESETS.map((p, i) => (
          <button key={i} className="cta-preset" style={{ borderColor: p.color }} onClick={() => addCta(p)} title="Ставится на текущее время курсора">{p.emoji} {p.text}</button>
        ))}
        <div className="cta-custom-input">
          <input value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Свой текст..." onKeyDown={(e) => e.key === 'Enter' && addCustom()} />
          <button onClick={addCustom} disabled={!customText.trim()}>+</button>
          <button onClick={uploadOverlay} title="Загрузить свой оверлей (PNG/GIF)">🖼</button>
        </div>
      </div>
      <div className="cta-track" ref={trackRef}>
        {items.map(item => (
          <div key={item.id} className="cta-marker" style={{ left: `${(item.timeSec / computedTotal) * 100}%`, '--cta-color': item.color }} onMouseDown={(e) => { e.preventDefault(); handleDrag(e, item); }} onClick={() => setEditing(item.id === editing ? null : item.id)} onContextMenu={(e) => { e.preventDefault(); remove(item.id); }}>
            <span className="cta-marker-label">{item.emoji || '📢'} {item.text}</span>
          </div>
        ))}
      </div>
      {editing && (() => {
        const item = items.find(i => i.id === editing);
        if (!item) return null;
        return (
          <div className="cta-editor">
            <label>Текст<input value={item.text} onChange={(e) => setItems(items.map(i => i.id === item.id ? {...i, text: e.target.value} : i))} onBlur={(e) => update(item.id, { text: e.target.value })} /></label>
            <label>Emoji<input value={item.emoji} style={{width:40}} onChange={(e) => { setItems(items.map(i => i.id === item.id ? {...i, emoji: e.target.value} : i)); update(item.id, { emoji: e.target.value }); }} /></label>
            <label>X %<input type="number" min="0" max="100" value={Math.round(item.x)} onChange={(e) => update(item.id, { x: Number(e.target.value) })} style={{width:50}} /></label>
            <label>Y %<input type="number" min="0" max="100" value={Math.round(item.y)} onChange={(e) => update(item.id, { y: Number(e.target.value) })} style={{width:50}} /></label>
            <label>Масштаб<input type="range" min="0.5" max="2.5" step="0.1" value={item.scale} onChange={(e) => update(item.id, { scale: Number(e.target.value) })} />{item.scale.toFixed(1)}x</label>
            <label>Анимация<select value={item.animation} onChange={(e) => update(item.id, { animation: e.target.value })}>{ANIMATIONS.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
            <label>Длит.<input type="number" min="0.5" max="10" step="0.5" value={item.durationSec} onChange={(e) => update(item.id, { durationSec: Number(e.target.value) })} style={{width:50}} />с</label>
            <input type="color" value={item.color} onChange={(e) => update(item.id, { color: e.target.value })} />
            <button className="ghost small danger" onClick={() => remove(item.id)}>✕</button>
          </div>
        );
      })()}
    </div>
  );
}
