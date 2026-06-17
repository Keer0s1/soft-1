import { useEffect, useState, useRef } from 'react';
import { api } from '../api.js';

export default function SfxTrack({ projectId, timeline }) {
  const { computedTotal, seek } = timeline;
  const [library, setLibrary] = useState([]);
  const [custom, setCustom] = useState([]);
  const [placements, setPlacements] = useState([]);
  const [tab, setTab] = useState('library');
  const [dragSound, setDragSound] = useState(null);
  const trackRef = useRef(null);

  useEffect(() => {
    api.sfxLibrary().then(setLibrary).catch(() => {});
    api.sfxCustom(projectId).then(setCustom).catch(() => {});
    api.sfxPlacements(projectId).then(setPlacements).catch(() => {});
  }, [projectId]);

  const refresh = () => api.sfxPlacements(projectId).then(setPlacements);

  const handleDrop = async (e) => {
    e.preventDefault();
    if (!dragSound || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const timeSec = Math.max(0, pct * computedTotal);
    await api.sfxPlace(projectId, {
      soundFile: dragSound.file,
      label: dragSound.label,
      timeSec: Math.round(timeSec * 100) / 100,
      category: dragSound.category,
    });
    setDragSound(null);
    refresh();
  };

  const handlePlacementDrag = (e, p) => {
    const rect = trackRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const origPct = p.timeSec / computedTotal;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const newPct = Math.max(0, Math.min(1, origPct + dx / rect.width));
      e.target.style.left = `${newPct * 100}%`;
    };
    const onUp = async (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const dx = ev.clientX - startX;
      const newPct = Math.max(0, Math.min(1, origPct + dx / rect.width));
      const newTime = Math.round(newPct * computedTotal * 100) / 100;
      await api.sfxMove(projectId, p.id, { timeSec: newTime });
      refresh();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const remove = async (pid) => {
    await api.sfxRemove(projectId, pid);
    refresh();
  };

  const uploadCustom = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'audio/*';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        await api.sfxUpload(projectId, ev.target.result, file.name);
        api.sfxCustom(projectId).then(setCustom);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const sounds = tab === 'library' ? library : custom;

  return (
    <div className="sfx-section">
      <div className="sfx-header">
        <span className="sfx-title">SFX</span>
        <button className={`sfx-tab${tab === 'library' ? ' active' : ''}`} onClick={() => setTab('library')}>Библиотека</button>
        <button className={`sfx-tab${tab === 'custom' ? ' active' : ''}`} onClick={() => setTab('custom')}>Свои</button>
        <button className="sfx-upload-btn" onClick={uploadCustom}>+ Загрузить</button>
      </div>
      <div className="sfx-sounds">
        {sounds.map(s => (
          <span key={s.id} className="sfx-chip" draggable onDragStart={() => setDragSound(s)} title="Перетащи на дорожку">{s.label}</span>
        ))}
        {sounds.length === 0 && <span className="muted small">{tab === 'library' ? 'Нет звуков в data/sfx/' : 'Загрузи свои звуки'}</span>}
      </div>
      <div className="sfx-track" ref={trackRef} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        {placements.map(p => (
          <div key={p.id} className="sfx-marker" style={{ left: `${(p.timeSec / computedTotal) * 100}%` }} onMouseDown={(e) => handlePlacementDrag(e, p)} onContextMenu={(e) => { e.preventDefault(); remove(p.id); }} title={`${p.label} @ ${p.timeSec.toFixed(1)}с (ПКМ удалить, перетащи)`}>
            <span className="sfx-marker-label">{p.label || '♪'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
