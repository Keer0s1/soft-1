import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api.js';
import { resolveEffectsFront } from '../resolveEffects.js';

export default function NleTimeline({ projectId, scenes, timeline, effects, onRefresh, project, onOpenFx, fxSceneId }) {
  const {
    sceneDurations, boundaries, computedTotal, currentTime,
    currentSceneIndex, selectedIds, toggleSelect, selectRange, seek, playheadRef,
  } = timeline;

  const resolved = useMemo(() => resolveEffectsFront(scenes, project), [scenes, project]);

  const [pxPerSec, setPxPerSec] = useState(80);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [resizing, setResizing] = useState(null);
  const [editSlot, setEditSlot] = useState(null);
  const [sfxItems, setSfxItems] = useState([]);
  const [ctaItems, setCtaItems] = useState([]);
  const [overlayItems, setOverlayItems] = useState([]);
  const [viewportWidth, setViewportWidth] = useState(800);

  const containerRef = useRef(null);
  const scrollLeftRef = useRef(0);
  const pxPerSecRef = useRef(80);
  const lastClickIdx = useRef(null);

  scrollLeftRef.current = scrollLeft;
  pxPerSecRef.current = pxPerSec;

  const safeTotal = computedTotal || 1;
  const totalWidth = safeTotal * pxPerSec;

  // Track viewport size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    ro.observe(el);
    setViewportWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Clamp scroll when zoom changes
  useEffect(() => {
    const max = Math.max(0, safeTotal * pxPerSec - viewportWidth);
    if (scrollLeft > max) { setScrollLeft(max); scrollLeftRef.current = max; }
  }, [pxPerSec, viewportWidth, safeTotal]);

  // Passive-false wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + scrollLeftRef.current;
        const timAtMouse = mouseX / pxPerSecRef.current;
        const factor = e.deltaY > 0 ? 0.85 : 1.18;
        const next = Math.max(10, Math.min(600, pxPerSecRef.current * factor));
        setPxPerSec(next);
        pxPerSecRef.current = next;
        const newScroll = Math.max(0, timAtMouse * next - (e.clientX - rect.left));
        setScrollLeft(newScroll);
        scrollLeftRef.current = newScroll;
      } else {
        e.preventDefault();
        const max = safeTotal * pxPerSecRef.current - (el.clientWidth || 800);
        const next = Math.max(0, Math.min(max, scrollLeftRef.current + e.deltaY + e.deltaX));
        setScrollLeft(next);
        scrollLeftRef.current = next;
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [safeTotal]);

  // Load SFX + CTA (reload when scenes change or project updates)
  useEffect(() => {
    api.sfxPlacements(projectId).then(setSfxItems).catch(() => {});
    api.ctaList(projectId).then(setCtaItems).catch(() => {});
    api.overlaysList(projectId).then(setOverlayItems).catch(() => {});
  }, [projectId, scenes]);

  const refreshTracks = () => {
    api.sfxPlacements(projectId).then(setSfxItems);
    api.ctaList(projectId).then(setCtaItems);
    api.overlaysList(projectId).then(setOverlayItems);
  };

  // Playhead scrub with snap
  const seekFromX = (clientX) => {
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollLeft;
    let t = Math.max(0, Math.min(computedTotal, x / pxPerSec));
    // Snap to scene boundaries (within 8px)
    for (const b of boundaries) {
      if (Math.abs(b * pxPerSec - x) < 8) { t = b; break; }
    }
    seek(t);
  };

  const startPlayheadDrag = (e) => {
    e.preventDefault();
    seekFromX(e.clientX);
    const onMove = (ev) => seekFromX(ev.clientX);
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Middle-button OR left-button (on empty space) pan
  const startPan = (e) => {
    if (e.button === 1) {
      e.preventDefault();
    } else if (e.button === 0 && e.target === containerRef.current) {
      // left-click on empty area
    } else {
      return;
    }
    e.preventDefault();
    const startX = e.clientX;
    const orig = scrollLeftRef.current;
    const onMove = (ev) => {
      const next = Math.max(0, orig - (ev.clientX - startX));
      setScrollLeft(next);
      scrollLeftRef.current = next;
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Scene click
  const handleSegClick = (e, scene, idx) => {
    if (e.shiftKey && lastClickIdx.current !== null) {
      selectRange(lastClickIdx.current, idx);
    } else {
      toggleSelect(scene.id, e.ctrlKey || e.metaKey);
    }
    lastClickIdx.current = idx;
  };

  // Resize scene duration
  const startResize = (e, idx) => {
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX;
    const origDur = sceneDurations[idx];
    const onMove = (ev) => setResizing({ idx, dur: Math.max(0.3, origDur + (ev.clientX - startX) / pxPerSec) });
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const final = Math.max(0.3, origDur + (ev.clientX - startX) / pxPerSec);
      setResizing(null);
      api.updateScene(projectId, scenes[idx].id, { durationOverride: Math.round(final * 10) / 10 }).then(() => onRefresh?.());
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    setResizing({ idx, dur: origDur });
  };

  // Effect slot change
  const setEffect = async (idx, type, value) => {
    const ov = { ...(scenes[idx].effectOverrides || {}) };
    if (value) ov[type] = value; else delete ov[type];
    const finalOv = Object.keys(ov).length ? ov : null;
    await api.updateScene(projectId, scenes[idx].id, { effectOverrides: finalOv });
    setEditSlot(null);
    onRefresh?.();
  };

  // Batch effect for selected
  const batchEffect = async (type, value) => {
    if (selectedIds.length < 2) return;
    const patch = { effectOverrides: { [type]: value || undefined } };
    await api.batchUpdateScenes(projectId, selectedIds, patch);
    setEditSlot(null);
    onRefresh?.();
  };

  // Time ruler ticks
  const rulerTicks = () => {
    const ticks = [];
    const step = pxPerSec > 200 ? 1 : pxPerSec > 80 ? 2 : pxPerSec > 40 ? 5 : 10;
    const startT = Math.floor(scrollLeft / pxPerSec / step) * step;
    const endT = Math.min(computedTotal, (scrollLeft + viewportWidth) / pxPerSec + step);
    for (let t = startT; t <= endT; t += step) {
      ticks.push({ t, x: t * pxPerSec - scrollLeft });
    }
    return ticks;
  };

  const minimapScale = viewportWidth / Math.max(1, totalWidth);
  const minimapViewX = scrollLeft * minimapScale;
  const minimapViewW = viewportWidth * minimapScale;

  const startMinimapDrag = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const setFromX = (cx) => {
      const pct = (cx - rect.left) / rect.width;
      setScrollLeft(Math.max(0, Math.min(totalWidth - viewportWidth, pct * totalWidth - viewportWidth / 2)));
    };
    setFromX(e.clientX);
    const onMove = (ev) => setFromX(ev.clientX);
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const fmt = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

  return (
    <div className="nle-timeline">
      <div className="nle-minimap" onMouseDown={startMinimapDrag}>
        {scenes.map((s, i) => {
          const w = (sceneDurations[i] / safeTotal) * 100;
          return <div key={s.id} className="nle-mm-seg" style={{ width: `${w}%`, background: s.imagePath ? `url(/files/${s.imagePath}) center/cover` : 'var(--border)' }} />;
        })}
        <div className="nle-mm-viewport" style={{ left: `${minimapViewX}px`, width: `${Math.max(20, minimapViewW)}px` }} />
        <div className="nle-mm-playhead" style={{ left: `${(currentTime / safeTotal) * 100}%` }} />
      </div>
      <div className="nle-container" ref={containerRef} onMouseDown={startPan}>
        <div className="nle-ruler" onMouseDown={startPlayheadDrag}>
          {rulerTicks().map(({ t, x }) => (
            <div key={t} className="nle-tick" style={{ left: `${x}px` }}><span>{fmt(t)}</span></div>
          ))}
          <div className="nle-ph-head" style={{ left: `${currentTime * pxPerSec - scrollLeft}px` }} />
        </div>
        <div className="nle-tracks">
          <div className="nle-playhead-line" style={{ left: `${currentTime * pxPerSec - scrollLeft}px` }} />
          <div className="nle-track nle-track-scenes">
            {scenes.map((s, i) => {
              const dur = resizing?.idx === i ? resizing.dur : sceneDurations[i];
              const left = boundaries[i] * pxPerSec - scrollLeft;
              const w = dur * pxPerSec;
              if (left + w < -10 || left > viewportWidth + 10) return null;
              const sel = selectedIds.includes(s.id);
              const cur = i === currentSceneIndex;
              return (
                <div key={s.id} className={`nle-seg${sel ? ' nle-sel' : ''}${cur ? ' nle-cur' : ''}${fxSceneId === s.id ? ' nle-fx-open' : ''}`} style={{ left: `${left}px`, width: `${w}px` }}
                  onClick={(e) => handleSegClick(e, s, i)}
                  onDoubleClick={(e) => { e.stopPropagation(); onOpenFx?.(s.id); }}
                  title="Двойной клик — настройки эффектов">
                  {s.imagePath && <img src={`/files/${s.imagePath}`} alt="" className="nle-thumb" />}
                  <span className="nle-num">{i + 1}</span>
                  {onOpenFx && w > 60 && (
                    <button className="nle-fx-btn" title="Настройки эффектов сцены"
                      onClick={(e) => { e.stopPropagation(); onOpenFx(s.id); }}>⚙</button>
                  )}
                  <div className="nle-handle" onMouseDown={(e) => startResize(e, i)} />
                </div>
              );
            })}
          </div>

          {/* Track 2: Effects/Transitions */}
          <div className="nle-track nle-track-fx">
            {scenes.map((s, i) => {
              const dur = resizing?.idx === i ? resizing.dur : sceneDurations[i];
              const left = boundaries[i] * pxPerSec - scrollLeft;
              const w = dur * pxPerSec;
              if (left + w < -10 || left > viewportWidth + 10) return null;
              const zoom = s.effectOverrides?.zoom || null;
              const trans = s.effectOverrides?.transition || null;
              const resolvedZoom = resolved.zoomSeq[i];
              const resolvedTrans = i < resolved.transSeq.length ? resolved.transSeq[i] : null;
              return (
                <div key={s.id} className="nle-fx-seg" style={{ left: `${left}px`, width: `${w}px` }}>
                  {editSlot?.idx === i && editSlot?.type === 'zoom' ? (
                    <select className="nle-fx-sel" autoFocus value={zoom || ''} onChange={(e) => setEffect(i, 'zoom', e.target.value)} onBlur={() => setTimeout(() => setEditSlot(null), 150)}>
                      <option value="">авто</option>
                      {(effects?.zoom || []).map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
                    </select>
                  ) : (
                    <span className={`nle-fx-pill${zoom ? ' set' : ''}`} onClick={() => setEditSlot({ idx: i, type: 'zoom' })}>{zoom || resolvedZoom || '·'}</span>
                  )}
                  {i < scenes.length - 1 && (
                    editSlot?.idx === i && editSlot?.type === 'transition' ? (
                      <select className="nle-fx-sel" autoFocus value={trans || ''} onChange={(e) => setEffect(i, 'transition', e.target.value)} onBlur={() => setTimeout(() => setEditSlot(null), 150)}>
                        <option value="">авто</option>
                        {(effects?.transitions || []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    ) : (
                      <span className={`nle-fx-pill trans${trans ? ' set' : ''}`} onClick={() => setEditSlot({ idx: i, type: 'transition' })}>↔{trans || resolvedTrans || ''}</span>
                    )
                  )}
                </div>
              );
            })}
          </div>

          {/* Track 3: SFX */}
          <div className="nle-track nle-track-sfx">
            {sfxItems.map(s => {
              const x = s.timeSec * pxPerSec - scrollLeft;
              if (x < -20 || x > viewportWidth + 20) return null;
              return <div key={s.id} className="nle-sfx-mark" style={{ left: `${x}px` }} title={`${s.label} @ ${s.timeSec.toFixed(1)}с`} onContextMenu={(e) => { e.preventDefault(); api.sfxRemove(projectId, s.id).then(refreshTracks); }}><span>{s.label || '♪'}</span></div>;
            })}
          </div>

          {/* Track 4: CTA */}
          <div className="nle-track nle-track-cta">
            {ctaItems.map(c => {
              const x = c.timeSec * pxPerSec - scrollLeft;
              const w = c.durationSec * pxPerSec;
              if (x + w < -10 || x > viewportWidth + 10) return null;
              return <div key={c.id} className="nle-cta-mark" style={{ left: `${x}px`, width: `${Math.max(20, w)}px`, background: c.color + '33' }} title={`${c.emoji} ${c.text} @ ${c.timeSec.toFixed(1)}с`} onContextMenu={(e) => { e.preventDefault(); api.ctaRemove(projectId, c.id).then(refreshTracks); }}><span>{c.emoji || '📢'} {c.text}</span></div>;
            })}
          </div>

          {/* Track 5: Overlays */}
          <div className="nle-track nle-track-overlays">
            {overlayItems.map(o => {
              const x = o.timeSec * pxPerSec - scrollLeft;
              const w = o.durationSec * pxPerSec;
              if (x + w < -10 || x > viewportWidth + 10) return null;
              const icon = o.type === 'text' ? 'T' : o.type === 'image' ? '🖼' : '🎬';
              return <div key={o.id} className="nle-overlay-mark" style={{ left: `${x}px`, width: `${Math.max(20, w)}px` }} title={`${o.type}: ${o.text || o.filePath?.split('/').pop() || ''}`} onContextMenu={(e) => { e.preventDefault(); api.overlayRemove(projectId, o.id).then(refreshTracks); }}><span>{icon} {o.type === 'text' ? o.text?.slice(0, 8) : ''}</span>{o.soundFile && <span className="nle-ov-sound">♪</span>}</div>;
            })}
          </div>
        </div>
      </div>

      {/* Scrollbar + Zoom controls */}
      <div className="nle-bottom-bar">
        <button className="nle-nav-btn" onClick={() => { setScrollLeft(0); scrollLeftRef.current = 0; }} title="В начало">⏮</button>
        <div className="nle-scrollbar-wrap">
          <input
            type="range"
            className="nle-scrollbar"
            min={0}
            max={Math.max(0, totalWidth - viewportWidth)}
            value={scrollLeft}
            step={1}
            onChange={(e) => { const v = Number(e.target.value); setScrollLeft(v); scrollLeftRef.current = v; }}
          />
        </div>
        <button className="nle-nav-btn" onClick={() => { const m = Math.max(0, totalWidth - viewportWidth); setScrollLeft(m); scrollLeftRef.current = m; }} title="В конец">⏭</button>
        <div className="nle-zoom-ctrl">
          <button className="nle-zoom-btn" onClick={() => { const n = Math.max(10, pxPerSec * 0.7); setPxPerSec(n); pxPerSecRef.current = n; }}>−</button>
          <input
            type="range"
            className="nle-zoom-slider"
            min={10}
            max={600}
            value={pxPerSec}
            step={1}
            onChange={(e) => { const v = Number(e.target.value); setPxPerSec(v); pxPerSecRef.current = v; }}
          />
          <button className="nle-zoom-btn" onClick={() => { const n = Math.min(600, pxPerSec * 1.4); setPxPerSec(n); pxPerSecRef.current = n; }}>+</button>
        </div>
      </div>
    </div>
  );
}