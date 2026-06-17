import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

const ANIM_IN = [
  { id: 'fadeIn', label: 'Плавное' },
  { id: 'slideLeft', label: 'Слева' },
  { id: 'slideRight', label: 'Справа' },
  { id: 'slideUp', label: 'Снизу' },
  { id: 'slideDown', label: 'Сверху' },
  { id: 'scaleUp', label: 'Увеличение' },
  { id: 'bounce', label: 'Отскок' },
  { id: 'elastic', label: 'Пружина' },
  { id: 'rotateIn', label: 'Вращение' },
];
const ANIM_OUT = [
  { id: 'fadeOut', label: 'Плавное' },
  { id: 'slideLeft', label: 'Влево' },
  { id: 'slideRight', label: 'Вправо' },
  { id: 'slideUp', label: 'Вверх' },
  { id: 'slideDown', label: 'Вниз' },
  { id: 'scaleDown', label: 'Уменьшение' },
  { id: 'bounce', label: 'Отскок' },
  { id: 'rotateOut', label: 'Вращение' },
];
const ANIM_IDLE = [
  { id: 'none', label: 'Нет' },
  { id: 'pulse', label: 'Пульс' },
  { id: 'float', label: 'Покачивание' },
  { id: 'shake', label: 'Тряска' },
  { id: 'glow', label: 'Свечение' },
];
const TEXT_PRESETS = [
  { id: 'custom', label: 'Свой' },
  { id: 'meme', label: 'Мем' },
  { id: 'subscribe', label: 'Подписка' },
  { id: 'quote', label: 'Цитата' },
  { id: 'title', label: 'Заголовок' },
];

const PRESET_STYLES = {
  meme: { fontFamily: 'Impact', fontSize: 64, fontColor: '#FFFFFF', fontWeight: 'bold', outlineWidth: 4, outlineColor: '#000000', bgEnabled: false },
  subscribe: { fontFamily: 'Arial', fontSize: 36, fontColor: '#FFFFFF', fontWeight: 'bold', outlineWidth: 0, bgEnabled: true, bgColor: '#FF0000', bgOpacity: 0.95, bgRadius: 12 },
  quote: { fontFamily: 'Georgia', fontSize: 42, fontColor: '#F0E68C', fontWeight: 'normal', outlineWidth: 2, outlineColor: '#333333', bgEnabled: false },
  title: { fontFamily: 'Arial', fontSize: 56, fontColor: '#FFFFFF', fontWeight: 'bold', outlineWidth: 3, outlineColor: '#000000', shadowSize: 4, bgEnabled: false },
};

const fmtTime = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

export default function OverlayTrack({ projectId, timeline, onChanged }) {
  const { computedTotal, currentTime, seek, isPlaying } = timeline;
  const [items, setItems] = useState([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [editing, setEditing] = useState(null);
  const [sounds, setSounds] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [scissorsMode, setScissorsMode] = useState(false);
  const [history, setHistory] = useState([]);
  const trackRef = useRef(null);
  const soundTrackRef = useRef(null);
  const soundRefs = useRef({});

  useEffect(() => {
    api.overlaysList(projectId).then(setItems).catch(() => {});
    api.overlaySounds().then(setSounds).catch(() => {});
  }, [projectId]);

  const refresh = () => api.overlaysList(projectId).then(setItems);

  const addOverlay = async (type) => {
    const data = { type, timeSec: currentTime || 0, durationSec: 3 };
    if (type === 'text') data.text = 'Текст';
    await api.overlayCreate(projectId, data);
    await refresh();
    onChanged?.();
  };

  const uploadFile = (type) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'image' ? 'image/*' : 'video/mp4,video/webm,video/mov';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await handleFile(file);
    };
    input.click();
  };

  const handleFile = async (file) => {
    const isVideo = /\.(mp4|webm|mov)$/i.test(file.name) || file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    const isAudio = /\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name) || file.type.startsWith('audio/');
    if (!isVideo && !isImage && !isAudio) return;
    const type = isAudio ? 'audio' : isVideo ? 'video' : 'image';
    pushHistory();
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const { path } = await api.overlayUpload(projectId, ev.target.result, file.name);
      await api.overlayCreate(projectId, { type, timeSec: currentTime || 0, filePath: path, durationSec: 3 });
      await refresh();
      onChanged?.();
    };
    reader.readAsDataURL(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) handleFile(file);
  };

  const dragCounter = useRef(0);
  const onDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setDragOver(true); };
  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const onDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false); } };

  const pushHistory = () => {
    setHistory(prev => [...prev.slice(-19), JSON.parse(JSON.stringify(items))]);
  };

  const undo = async () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    for (const item of items) { await api.overlayRemove(projectId, item.id).catch(() => {}); }
    for (const item of prev) {
      const { id, projectId: _p, createdAt, ...data } = item;
      await api.overlayCreate(projectId, data).catch(() => {});
    }
    await refresh();
    onChanged?.();
  };

  const undoRef = useRef(undo);
  undoRef.current = undo;

  useEffect(() => {
    const handler = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoRef.current(); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const update = async (oid, patch) => {
    pushHistory();
    await api.overlayUpdate(projectId, oid, patch);
    setItems(prev => prev.map(i => i.id === oid ? { ...i, ...patch } : i));
    onChanged?.();
  };

  const remove = async (oid) => {
    pushHistory();
    await api.overlayRemove(projectId, oid);
    setItems(prev => prev.filter(i => i.id !== oid));
    if (editing?.id === oid) setEditing(null);
    onChanged?.();
  };

  const addAudio = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      pushHistory();
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const { path } = await api.overlayUpload(projectId, ev.target.result, file.name);
        await api.overlayCreate(projectId, { type: 'audio', timeSec: currentTime || 0, filePath: path, durationSec: 3 });
        await refresh();
        onChanged?.();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const dragItem = (e, item) => {
    e.stopPropagation();
    const startX = e.clientX;
    let moved = false;
    const rect = trackRef.current.getBoundingClientRect();
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      if (!moved) return;
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const t = pct * computedTotal;
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, timeSec: t } : i));
    };
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!moved) return;
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      update(item.id, { timeSec: Math.round(pct * computedTotal * 10) / 10 });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const uploadSound = (oid) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const { path } = await api.overlayUpload(projectId, ev.target.result, file.name);
        await update(oid, { soundFile: path });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const applyPreset = (oid, presetId) => {
    const style = PRESET_STYLES[presetId];
    if (style) update(oid, { ...style, textPreset: presetId });
    else update(oid, { textPreset: presetId });
  };

  const editItem = editing ? items.find(i => i.id === editing.id) : null;

  // Play overlay sounds only during playback
  useEffect(() => {
    if (!isPlaying) return;
    for (const item of items) {
      const sf = item.type === 'audio' ? item.filePath : item.soundFile;
      if (!sf) continue;
      const shouldPlay = currentTime >= item.timeSec && currentTime < item.timeSec + 0.15;
      if (shouldPlay && !soundRefs.current[item.id]) {
        const audio = new Audio(`/files/${sf}`);
        audio.volume = item.soundVolume ?? 1;
        audio.play().catch(() => {});
        soundRefs.current[item.id] = audio;
        audio.onended = () => { delete soundRefs.current[item.id]; };
      }
      if (currentTime < item.timeSec && soundRefs.current[item.id]) {
        soundRefs.current[item.id].pause();
        delete soundRefs.current[item.id];
      }
    }
  }, [currentTime, items, isPlaying]);

  // Split overlay at current time (scissors)
  const splitAt = async (item) => {
    const splitTime = currentTime;
    if (splitTime <= item.timeSec || splitTime >= item.timeSec + item.durationSec) return;
    pushHistory();
    const dur1 = splitTime - item.timeSec;
    const dur2 = (item.timeSec + item.durationSec) - splitTime;
    await update(item.id, { durationSec: Math.round(dur1 * 10) / 10 });
    const newData = { type: item.type, timeSec: Math.round(splitTime * 10) / 10, durationSec: Math.round(dur2 * 10) / 10, text: item.text, filePath: item.filePath, x: item.x, y: item.y, scale: item.scale, rotation: item.rotation, animIn: item.animIn, animOut: item.animOut, animIdle: item.animIdle, animInDur: item.animInDur, animOutDur: item.animOutDur, fontFamily: item.fontFamily, fontSize: item.fontSize, fontColor: item.fontColor, fontWeight: item.fontWeight, outlineWidth: item.outlineWidth, outlineColor: item.outlineColor, shadowSize: item.shadowSize, bgEnabled: item.bgEnabled, bgColor: item.bgColor, bgOpacity: item.bgOpacity, bgRadius: item.bgRadius, textPreset: item.textPreset, soundFile: item.soundFile, soundVolume: item.soundVolume };
    await api.overlayCreate(projectId, newData);
    await refresh();
    onChanged?.();
  };

  const dragSoundItem = (e, item) => {
    e.stopPropagation();
    const startX = e.clientX;
    let moved = false;
    const rect = soundTrackRef.current?.getBoundingClientRect() || trackRef.current.getBoundingClientRect();
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      if (!moved) return;
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const t = pct * computedTotal;
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, timeSec: t } : i));
    };
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!moved) return;
      pushHistory();
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      update(item.id, { timeSec: Math.round(pct * computedTotal * 10) / 10 });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const resizeItem = (e, item, edge, refEl) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = (refEl || trackRef.current).getBoundingClientRect();
    const origStart = item.timeSec;
    const origEnd = item.timeSec + item.durationSec;
    pushHistory();
    const onMove = (ev) => {
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const t = pct * computedTotal;
      if (edge === 'left') {
        const newStart = Math.max(0, Math.min(t, origEnd - 0.2));
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, timeSec: newStart, durationSec: origEnd - newStart } : i));
      } else {
        const newEnd = Math.max(origStart + 0.2, t);
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, durationSec: newEnd - origStart } : i));
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const cur = itemsRef.current.find(i => i.id === item.id);
      if (cur) update(item.id, { timeSec: Math.round(cur.timeSec * 10) / 10, durationSec: Math.round(cur.durationSec * 10) / 10 });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className={`overlay-track-panel${dragOver ? ' overlay-drag-active' : ''}`} onDrop={onDrop} onDragOver={onDragOver} onDragEnter={onDragEnter} onDragLeave={onDragLeave}>
      <div className="overlay-track-header">
        <span className="overlay-track-title">Оверлеи</span>
        <button className={`overlay-add-btn${scissorsMode ? ' overlay-scissors-active' : ''}`} onClick={() => setScissorsMode(!scissorsMode)} title="Ножницы — разрезать">&#9986;</button>
        <button className="overlay-add-btn" onClick={undo} disabled={history.length === 0} title="Отменить (Ctrl+Z)">&#8630;</button>
        <button className="overlay-add-btn" onClick={() => addOverlay('text')}>T</button>
        <button className="overlay-add-btn" onClick={() => uploadFile('image')}>Фото</button>
        <button className="overlay-add-btn" onClick={() => uploadFile('video')}>Видео</button>
        <button className="overlay-add-btn" onClick={addAudio}>♪ Звук</button>
      </div>
      <div className={`overlay-track-strip${scissorsMode ? ' scissors-cursor' : ''}`} ref={trackRef} onMouseDown={(e) => {
        if (e.target === trackRef.current || e.target.classList.contains('overlay-track-playhead')) {
          const rect = trackRef.current.getBoundingClientRect();
          const scrub = (ev) => { const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)); seek(pct * computedTotal); };
          scrub(e);
          const onMove = (ev) => scrub(ev);
          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }
      }}>
        {items.filter(i => i.type !== 'audio').map(item => {
          const left = computedTotal > 0 ? (item.timeSec / computedTotal) * 100 : 0;
          const width = computedTotal > 0 ? (item.durationSec / computedTotal) * 100 : 5;
          const icon = item.type === 'text' ? 'T' : item.type === 'image' ? '🖼' : '🎬';
          const active = editing?.id === item.id;
          return (
            <div key={item.id}
              className={`overlay-track-item${active ? ' active' : ''}`}
              style={{ left: `${left}%`, width: `${Math.max(2, width)}%` }}
              onMouseDown={(e) => { if (!scissorsMode) dragItem(e, item); }}
              onClick={(e) => { e.stopPropagation(); if (scissorsMode) { splitAt(item); setScissorsMode(false); } else { setEditing(active ? null : { id: item.id }); } }}
              onContextMenu={(e) => { e.preventDefault(); remove(item.id); }}
              title={scissorsMode ? 'Разрезать здесь' : `${item.type}: ${item.text || item.filePath || ''}`}
            >
              <div className="ov-resize-handle ov-resize-left" onMouseDown={(e) => resizeItem(e, item, 'left', trackRef.current)} />
              <span className="overlay-item-icon">{icon}</span>
              <div className="ov-resize-handle ov-resize-right" onMouseDown={(e) => resizeItem(e, item, 'right', trackRef.current)} />
            </div>
          );
        })}
        <div className="overlay-track-playhead" style={{ left: `${computedTotal > 0 ? (currentTime / computedTotal) * 100 : 0}%` }} />
      </div>
      {/* Audio track — independent */}
      <div className={`overlay-sound-strip${scissorsMode ? ' scissors-cursor' : ''}`} ref={soundTrackRef}>
        {items.filter(i => i.type === 'audio' || i.soundFile).map(item => {
          const left = computedTotal > 0 ? (item.timeSec / computedTotal) * 100 : 0;
          const width = computedTotal > 0 ? (item.durationSec / computedTotal) * 100 : 5;
          const active = editing?.id === item.id;
          const label = item.type === 'audio' ? (item.filePath?.split('/').pop()?.slice(0, 14) || '♪') : ('♪ ' + (item.soundFile?.split('/').pop()?.slice(0, 10) || ''));
          return (
            <div key={item.id + '-snd'} className={`overlay-sound-block${active ? ' active' : ''}`}
              style={{ left: `${left}%`, width: `${Math.max(2, width)}%` }}
              onMouseDown={(e) => { if (!scissorsMode && item.type === 'audio') dragSoundItem(e, item); }}
              onClick={(e) => { e.stopPropagation(); if (scissorsMode && item.type === 'audio') { splitAt(item); setScissorsMode(false); } else if (item.type === 'audio') { setEditing(active ? null : { id: item.id }); } }}
              onContextMenu={(e) => { e.preventDefault(); if (item.type === 'audio') remove(item.id); }}
              title={scissorsMode ? 'Разрезать звук' : label}
            >
              {item.type === 'audio' && <div className="ov-resize-handle ov-resize-left" onMouseDown={(e) => resizeItem(e, item, 'left', soundTrackRef.current)} />}
              <span>{label}</span>
              {item.type === 'audio' && <div className="ov-resize-handle ov-resize-right" onMouseDown={(e) => resizeItem(e, item, 'right', soundTrackRef.current)} />}
            </div>
          );
        })}
        <div className="overlay-track-playhead" style={{ left: `${computedTotal > 0 ? (currentTime / computedTotal) * 100 : 0}%` }} />
      </div>
      <div className="overlay-scrubber">
        <input type="range" min="0" max={Math.max(1, computedTotal)} step="0.1" value={currentTime} onChange={(e) => seek(Number(e.target.value))} />
        <span className="overlay-scrubber-time">{fmtTime(currentTime)} / {fmtTime(computedTotal)}</span>
      </div>

      {editItem && (
        <div className="overlay-settings">
          <div className="overlay-settings-header">
            <span>{editItem.type === 'text' ? 'Текст' : editItem.type === 'image' ? 'Фото' : editItem.type === 'audio' ? 'Звук' : 'Видео'} оверлей</span>
            <button className="overlay-close-btn" onClick={() => setEditing(null)}>x</button>
          </div>

          {editItem.type === 'audio' ? (
            <div className="overlay-settings-col">
              <label>Время (сек)<input type="number" step="0.1" min="0" value={editItem.timeSec ?? 0} onChange={(e) => update(editItem.id, { timeSec: +e.target.value })} /></label>
              <label>Длительность<input type="number" step="0.1" min="0.1" value={editItem.durationSec ?? 3} onChange={(e) => update(editItem.id, { durationSec: +e.target.value })} /></label>
              <label>Громкость<input type="range" min="0" max="2" step="0.1" value={editItem.soundVolume ?? 1} onChange={(e) => update(editItem.id, { soundVolume: +e.target.value })} /><span>{editItem.soundVolume ?? 1}</span></label>
              {editItem.filePath && <span className="overlay-sound-name">♪ {editItem.filePath.split('/').pop()}</span>}
              <button className="overlay-delete-btn" onClick={() => remove(editItem.id)}>Удалить звук</button>
            </div>
          ) : (
          <>
          <div className="overlay-settings-grid">
            <div className="overlay-settings-col">
              <label>Время (сек)<input type="number" step="0.1" min="0" value={editItem.timeSec} onChange={(e) => update(editItem.id, { timeSec: +e.target.value })} /></label>
              <label>Длительность<input type="number" step="0.1" min="0.2" value={editItem.durationSec} onChange={(e) => update(editItem.id, { durationSec: +e.target.value })} /></label>
              <label>X (%)<input type="range" min="0" max="100" value={editItem.x} onChange={(e) => update(editItem.id, { x: +e.target.value })} /><span>{Math.round(editItem.x)}</span></label>
              <label>Y (%)<input type="range" min="0" max="100" value={editItem.y} onChange={(e) => update(editItem.id, { y: +e.target.value })} /><span>{Math.round(editItem.y)}</span></label>
              <label>Масштаб<input type="range" min="0.2" max="3" step="0.1" value={editItem.scale} onChange={(e) => update(editItem.id, { scale: +e.target.value })} /><span>{editItem.scale}x</span></label>
              <label>Поворот<input type="range" min="-180" max="180" step="1" value={editItem.rotation} onChange={(e) => update(editItem.id, { rotation: +e.target.value })} /><span>{editItem.rotation}°</span></label>
            </div>
            <div className="overlay-settings-col">
              <label>Появление<select value={editItem.animIn} onChange={(e) => update(editItem.id, { animIn: e.target.value })}>{ANIM_IN.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
              <label>Скорость входа<input type="range" min="0.1" max="1.5" step="0.1" value={editItem.animInDur} onChange={(e) => update(editItem.id, { animInDur: +e.target.value })} /><span>{editItem.animInDur}с</span></label>
              <label>Исчезание<select value={editItem.animOut} onChange={(e) => update(editItem.id, { animOut: e.target.value })}>{ANIM_OUT.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
              <label>Скорость выхода<input type="range" min="0.1" max="1.5" step="0.1" value={editItem.animOutDur} onChange={(e) => update(editItem.id, { animOutDur: +e.target.value })} /><span>{editItem.animOutDur}с</span></label>
              <label>Анимация (idle)<select value={editItem.animIdle} onChange={(e) => update(editItem.id, { animIdle: e.target.value })}>{ANIM_IDLE.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
            </div>
            <div className="overlay-settings-col">
              <label>Звук</label>
              {editItem.soundFile ? (
                <div className="overlay-sound-row">
                  <span className="overlay-sound-name">{editItem.soundFile.split('/').pop()}</span>
                  <button onClick={() => update(editItem.id, { soundFile: null })}>x</button>
                </div>
              ) : (
                <div className="overlay-sound-row">
                  <select onChange={(e) => { if (e.target.value) update(editItem.id, { soundFile: e.target.value }); }}>
                    <option value="">Выбрать...</option>
                    {sounds.map(s => <option key={s.id} value={s.path}>{s.label}</option>)}
                  </select>
                  <button onClick={() => uploadSound(editItem.id)}>Загрузить</button>
                </div>
              )}
              {editItem.soundFile && <label>Громкость<input type="range" min="0" max="2" step="0.1" value={editItem.soundVolume} onChange={(e) => update(editItem.id, { soundVolume: +e.target.value })} /><span>{editItem.soundVolume}</span></label>}
            </div>
          </div>

          {editItem.type === 'text' && (
            <div className="overlay-text-settings">
              <label>Текст<input type="text" value={editItem.text} onChange={(e) => update(editItem.id, { text: e.target.value })} /></label>
              <div className="overlay-text-row">
                <label>Пресет<select value={editItem.textPreset} onChange={(e) => applyPreset(editItem.id, e.target.value)}>{TEXT_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <label>Шрифт<select value={editItem.fontFamily} onChange={(e) => update(editItem.id, { fontFamily: e.target.value })}>
                  <option value="Arial">Arial</option><option value="Impact">Impact</option><option value="Georgia">Georgia</option>
                  <option value="Verdana">Verdana</option><option value="Courier New">Courier</option>
                </select></label>
                <label>Размер<input type="number" min="12" max="128" value={editItem.fontSize} onChange={(e) => update(editItem.id, { fontSize: +e.target.value })} /></label>
              </div>
              <div className="overlay-text-row">
                <label>Цвет<input type="color" value={editItem.fontColor} onChange={(e) => update(editItem.id, { fontColor: e.target.value })} /></label>
                <label>Обводка<input type="range" min="0" max="8" value={editItem.outlineWidth} onChange={(e) => update(editItem.id, { outlineWidth: +e.target.value })} /><span>{editItem.outlineWidth}</span></label>
                <label>Цвет обв.<input type="color" value={editItem.outlineColor} onChange={(e) => update(editItem.id, { outlineColor: e.target.value })} /></label>
                <label>Тень<input type="range" min="0" max="8" value={editItem.shadowSize} onChange={(e) => update(editItem.id, { shadowSize: +e.target.value })} /><span>{editItem.shadowSize}</span></label>
              </div>
              <div className="overlay-text-row">
                <label><input type="checkbox" checked={editItem.bgEnabled} onChange={(e) => update(editItem.id, { bgEnabled: e.target.checked })} /> Фон</label>
                {editItem.bgEnabled && <>
                  <label>Цвет фона<input type="color" value={editItem.bgColor} onChange={(e) => update(editItem.id, { bgColor: e.target.value })} /></label>
                  <label>Прозр.<input type="range" min="0" max="1" step="0.05" value={editItem.bgOpacity} onChange={(e) => update(editItem.id, { bgOpacity: +e.target.value })} /></label>
                  <label>Радиус<input type="range" min="0" max="24" value={editItem.bgRadius} onChange={(e) => update(editItem.id, { bgRadius: +e.target.value })} /></label>
                </>}
              </div>
            </div>
          )}

          {(editItem.type === 'image' || editItem.type === 'video') && editItem.filePath && (
            <div className="overlay-file-preview">
              {editItem.type === 'image' ? <img src={`/files/${editItem.filePath}`} alt="" /> : <video src={`/files/${editItem.filePath}`} muted loop autoPlay />}
            </div>
          )}

          <button className="overlay-delete-btn" onClick={() => remove(editItem.id)}>Удалить оверлей</button>
          </>
          )}
        </div>
      )}
    </div>
  );
}