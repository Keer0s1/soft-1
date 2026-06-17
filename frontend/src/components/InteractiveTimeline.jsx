import { useRef, useState } from 'react';
import { api } from '../api.js';

export default function InteractiveTimeline({
  projectId, scenes, timeline, effects, onRefresh,
}) {
  const {
    sceneDurations, boundaries, computedTotal, currentTime,
    currentSceneIndex, selectedIds, toggleSelect, selectRange, seek, playheadRef,
  } = timeline;

  const trackRef = useRef(null);
  const [resizing, setResizing] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [dragItem, setDragItem] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const lastClickIdx = useRef(null);

  const timeToPercent = (t) => (t / computedTotal) * 100;

  const handleTrackClick = (e) => {
    if (resizing) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seek(pct * computedTotal);
  };

  const handleTrackScrub = (e) => {
    if (resizing) return;
    handleTrackClick(e);
    const onMove = (ev) => {
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      seek(pct * computedTotal);
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleSegClick = (e, scene, idx) => {
    e.stopPropagation();
    if (e.shiftKey && lastClickIdx.current !== null) {
      selectRange(lastClickIdx.current, idx);
    } else {
      toggleSelect(scene.id, e.ctrlKey || e.metaKey);
    }
    lastClickIdx.current = idx;
  };

  const handleContextMenu = (e, scene, idx) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, scene, idx });
  };

  const closeCtx = () => setCtxMenu(null);

  const handleResizeStart = (e, idx) => {
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX;
    const rect = trackRef.current.getBoundingClientRect();
    const pxPerSec = rect.width / computedTotal;
    const origDur = sceneDurations[idx];
    const onMove = (ev) => setResizing({ idx, dur: Math.max(0.5, origDur + (ev.clientX - startX) / pxPerSec) });
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setResizing(null);
      const finalDur = Math.max(0.5, origDur + (ev.clientX - startX) / pxPerSec);
      api.updateScene(projectId, scenes[idx].id, { durationOverride: Math.round(finalDur * 10) / 10 }).then(() => onRefresh?.());
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    setResizing({ idx, dur: origDur });
  };

  const onPaletteDragStart = (e, type, id) => { setDragItem({ type, id }); e.dataTransfer.effectAllowed = 'copy'; };
  const onSegDragOver = (e, idx, slot) => { e.preventDefault(); setDropTarget({ idx, slot }); };
  const onSegDrop = async (e, idx, slot) => {
    e.preventDefault(); setDropTarget(null);
    if (!dragItem) return;
    const scene = scenes[idx];
    const ov = { ...(scene.effectOverrides || {}) };
    if (dragItem.type === 'zoom' && slot === 'scene') ov.zoom = dragItem.id;
    else if (dragItem.type === 'transition' && slot === 'gap') ov.transition = dragItem.id;
    else { setDragItem(null); return; }
    await api.updateScene(projectId, scene.id, { effectOverrides: ov });
    setDragItem(null); onRefresh?.();
  };
  const resetEffect = async (idx, key) => {
    closeCtx();
    const ov = { ...(scenes[idx].effectOverrides || {}) }; delete ov[key];
    await api.updateScene(projectId, scenes[idx].id, { effectOverrides: Object.keys(ov).length ? ov : null });
    onRefresh?.();
  };
  const [editPill, setEditPill] = useState(null); // {idx, type:'zoom'|'transition'}
  const getZoomLabel = (s) => { const o = s.effectOverrides; return o?.disableZoom ? 'off' : o?.zoom || null; };
  const getTransLabel = (s) => { const o = s.effectOverrides; return o?.disableTransition ? 'off' : o?.transition || null; };

  const setPillEffect = async (idx, type, value) => {
    const ov = { ...(scenes[idx].effectOverrides || {}) };
    if (value) ov[type] = value;
    else delete ov[type];
    await api.updateScene(projectId, scenes[idx].id, { effectOverrides: Object.keys(ov).length ? ov : null });
    setEditPill(null);
    onRefresh?.();
  };

  return (
    <div className="int-timeline" onClick={closeCtx} onDragEnd={() => { setDragItem(null); setDropTarget(null); }}>
      <div className="tl-palette">
        <div className="tl-palette-section">
          <span className="tl-palette-label">Зум:</span>
          <div className="tl-palette-items">
            {(effects?.zoom || []).slice(0, 8).map((z) => (
              <span key={z.id} className="tl-pill tl-pill-zoom" draggable onDragStart={(e) => onPaletteDragStart(e, 'zoom', z.id)} title={z.label}>{z.id}</span>
            ))}
          </div>
        </div>
        <div className="tl-palette-section">
          <span className="tl-palette-label">Переход:</span>
          <div className="tl-palette-items">
            {(effects?.transitions || []).slice(0, 8).map((t) => (
              <span key={t.id} className="tl-pill tl-pill-trans" draggable onDragStart={(e) => onPaletteDragStart(e, 'transition', t.id)} title={t.label}>{t.id}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="tl-scroll">
        <div className="tl-track tl-video" ref={trackRef} onMouseDown={handleTrackScrub}>
          {scenes.map((s, i) => {
            const dur = resizing?.idx === i ? resizing.dur : sceneDurations[i];
            const w = (dur / computedTotal) * 100;
            const cls = `tl-seg${selectedIds.includes(s.id) ? ' tl-selected' : ''}${i === currentSceneIndex ? ' tl-current' : ''}${dropTarget?.idx === i && dropTarget?.slot === 'scene' ? ' tl-drop' : ''}`;
            return (
              <div key={s.id} className={cls} style={{ width: `${w}%` }} onClick={(e) => handleSegClick(e, s, i)} onContextMenu={(e) => handleContextMenu(e, s, i)} onDragOver={(e) => onSegDragOver(e, i, 'scene')} onDrop={(e) => onSegDrop(e, i, 'scene')} title={`Сцена ${i+1}: ${dur.toFixed(1)}с`}>
                {s.imagePath && <img src={`/files/${s.imagePath}`} alt="" className="tl-thumb" />}
                <span className="tl-num">{i + 1}</span>
                {i < scenes.length - 1 && <div className="tl-handle" onMouseDown={(e) => handleResizeStart(e, i)} />}
              </div>
            );
          })}
          <div className="tl-playhead" ref={playheadRef} style={{ left: `${timeToPercent(currentTime)}%` }} />
        </div>
        <div className="tl-track tl-effects">
          {scenes.map((s, i) => {
            const dur = resizing?.idx === i ? resizing.dur : sceneDurations[i];
            const w = (dur / computedTotal) * 100;
            const zoom = getZoomLabel(s);
            const trans = getTransLabel(s);
            return (
              <div key={s.id} className="tl-fx-seg" style={{ width: `${w}%` }} onDragOver={(e) => onSegDragOver(e, i, 'scene')} onDrop={(e) => onSegDrop(e, i, 'scene')}>
                {editPill?.idx === i && editPill?.type === 'zoom' ? (
                  <select className="tl-fx-select" autoFocus value={zoom || ''} onChange={(e) => setPillEffect(i, 'zoom', e.target.value || undefined)} onBlur={() => setEditPill(null)}>
                    <option value="">авто</option>
                    {(effects?.zoom || []).map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
                  </select>
                ) : (
                  <span className={`tl-fx-pill${zoom ? ' tl-fx-set' : ''}`} onClick={() => setEditPill({ idx: i, type: 'zoom' })} title="Клик: выбрать зум">{zoom || '·'}</span>
                )}
                {i < scenes.length - 1 && (
                  editPill?.idx === i && editPill?.type === 'transition' ? (
                    <select className="tl-fx-select" autoFocus value={trans || ''} onChange={(e) => setPillEffect(i, 'transition', e.target.value || undefined)} onBlur={() => setEditPill(null)} onDragOver={(e) => onSegDragOver(e, i, 'gap')} onDrop={(e) => onSegDrop(e, i, 'gap')}>
                      <option value="">авто</option>
                      {(effects?.transitions || []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  ) : (
                    <span className={`tl-fx-gap${trans ? ' tl-fx-set' : ''}${dropTarget?.idx === i && dropTarget?.slot === 'gap' ? ' tl-drop' : ''}`} onClick={() => setEditPill({ idx: i, type: 'transition' })} onDragOver={(e) => onSegDragOver(e, i, 'gap')} onDrop={(e) => onSegDrop(e, i, 'gap')} title="Клик: выбрать переход">↔{trans || ''}</span>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="tl-ruler"><span>0:00</span><span>{fmt(computedTotal / 2)}</span><span>{fmt(computedTotal)}</span></div>
      {ctxMenu && (
        <div className="tl-ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="tl-ctx-title">Сцена {ctxMenu.idx + 1}</div>
          <div className="tl-ctx-group"><span className="tl-ctx-label">Зум:</span><select onChange={(e) => { const v = e.target.value; const o = {...(scenes[ctxMenu.idx].effectOverrides||{})}; if(v) o.zoom=v; else delete o.zoom; api.updateScene(projectId,scenes[ctxMenu.idx].id,{effectOverrides:Object.keys(o).length?o:null}).then(()=>onRefresh?.()); closeCtx(); }} defaultValue={scenes[ctxMenu.idx]?.effectOverrides?.zoom||''}><option value="">Авто</option>{(effects?.zoom||[]).map(z=><option key={z.id} value={z.id}>{z.label}</option>)}</select></div>
          <div className="tl-ctx-group"><span className="tl-ctx-label">Переход:</span><select onChange={(e) => { const v = e.target.value; const o = {...(scenes[ctxMenu.idx].effectOverrides||{})}; if(v) o.transition=v; else delete o.transition; api.updateScene(projectId,scenes[ctxMenu.idx].id,{effectOverrides:Object.keys(o).length?o:null}).then(()=>onRefresh?.()); closeCtx(); }} defaultValue={scenes[ctxMenu.idx]?.effectOverrides?.transition||''}><option value="">Авто</option>{(effects?.transitions||[]).map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
          <button className="ghost small" onClick={() => resetEffect(ctxMenu.idx, 'zoom')}>Сбросить зум</button>
          <button className="ghost small" onClick={() => resetEffect(ctxMenu.idx, 'transition')}>Сбросить переход</button>
        </div>
      )}
    </div>
  );
}

function fmt(sec) { if (!sec || !isFinite(sec)) return '0:00'; return `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`; }
