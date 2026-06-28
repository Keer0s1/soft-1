import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { api } from '../api.js';
import { resolveEffectsFront } from '../resolveEffects.js';
import SubtitlesPanel from './SubtitlesPanel.jsx';
import Icon from './Icon.jsx';

const ZOOM_CSS = {
  in: { from: 'scale(1)', to: 'scale(1.12)' },
  out: { from: 'scale(1.12)', to: 'scale(1)' },
  left: { from: 'scale(1.08) translateX(2%)', to: 'scale(1.08) translateX(-2%)' },
  right: { from: 'scale(1.08) translateX(-2%)', to: 'scale(1.08) translateX(2%)' },
  up: { from: 'scale(1.08) translateY(2%)', to: 'scale(1.08) translateY(-2%)' },
  down: { from: 'scale(1.08) translateY(-2%)', to: 'scale(1.08) translateY(2%)' },
  inUp: { from: 'scale(1) translateY(0)', to: 'scale(1.12) translateY(-3%)' },
  inDown: { from: 'scale(1) translateY(0)', to: 'scale(1.12) translateY(3%)' },
  slowDrift: { from: 'scale(1.06) translate(-2%, -1%)', to: 'scale(1.06) translate(2%, 1%)' },
  breathe: { anim: 'pp-breathe' },
  cinematic: { from: 'scale(1.06) translate(-1.5%, 0.5%)', to: 'scale(1.06) translate(1.5%, -0.5%)' },
};

const TRANSITION_CSS = {
  fade: 'pp-tr-fade', fadeblack: 'pp-tr-fadeblack', fadewhite: 'pp-tr-fadewhite', dissolve: 'pp-tr-fade',
  wipeleft: 'pp-tr-wipeleft', wiperight: 'pp-tr-wiperight', wipeup: 'pp-tr-wipeup', wipedown: 'pp-tr-wipedown',
  slideleft: 'pp-tr-slideleft', slideright: 'pp-tr-slideright', slideup: 'pp-tr-slideup', slidedown: 'pp-tr-slidedown',
  smoothleft: 'pp-tr-slideleft', smoothright: 'pp-tr-slideright', smoothup: 'pp-tr-slideup', smoothdown: 'pp-tr-slidedown',
  circleopen: 'pp-tr-circleopen', circleclose: 'pp-tr-circleclose', radial: 'pp-tr-circleopen',
  pixelize: 'pp-tr-pixelize',
  diagbl: 'pp-tr-diagbl', diagbr: 'pp-tr-diagbr', diagtl: 'pp-tr-diagtl', diagtr: 'pp-tr-diagtr',
  hlslice: 'pp-tr-fade', vuslice: 'pp-tr-slideup', vdslice: 'pp-tr-slidedown',
  horzopen: 'pp-tr-horzopen', vertopen: 'pp-tr-vertopen', horzclose: 'pp-tr-horzclose', vertclose: 'pp-tr-vertclose',
};

const SUB_FONTS = { modern: 'Arial, sans-serif', classic: 'Times New Roman, serif', bold: 'Impact, sans-serif', minimal: 'Arial, sans-serif' };

export default function PreviewPlayer({ scenes, timeline, voicePreviewPath, project, onPatch, videoPreviewPath, videoPreviewStatus, onRenderPreview, vpPercent, vpVersion, vpStep }) {
  const { currentTime, isPlaying, currentSceneIndex, computedTotal, sceneDurations, play, pause, seek, audioRef } = timeline;
  const [prevIdx, setPrevIdx] = useState(-1);
  const [fading, setFading] = useState(false);
  const [useVideoPreview, setUseVideoPreview] = useState(true);
  const [videoSrc, setVideoSrc] = useState(null);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef(null);
  const [ctaItems, setCtaItems] = useState([]);
  const [overlayItems, setOverlayItems] = useState([]);
  const [wordTimestamps, setWordTimestamps] = useState([]);
  const [scrubbing, setScrubbing] = useState(false);
  const [showSubSettings, setShowSubSettings] = useState(false);
  const progressRef = useRef(null);
  const displayRef = useRef(null);
  const scaleTimerRef = useRef(null);

  const resolved = useMemo(() => resolveEffectsFront(scenes, project), [scenes, project]);

  useEffect(() => {
    if (!project?.id) return;
    const fetch = () => {
      api.ctaList(project.id).then(setCtaItems).catch(() => {});
      api.overlaysList(project.id).then(setOverlayItems).catch(() => {});
    };
    fetch();
    api.voiceTimestamps(project.id).then(ts => setWordTimestamps(ts || [])).catch(() => {});
    const t = setInterval(fetch, 3000);
    return () => clearInterval(t);
  }, [project?.id, scenes]);

  useEffect(() => {
    if (currentSceneIndex !== prevIdx && currentSceneIndex >= 0) {
      if (!isPlaying) {
        setPrevIdx(currentSceneIndex);
        setFading(false);
        return;
      }
      setFading(true);
      const dur = project?.transitionEnabled ? (project.transitionDuration || 0.5) * 1000 : 300;
      const t = setTimeout(() => { setPrevIdx(currentSceneIndex); setFading(false); }, dur);
      return () => clearTimeout(t);
    }
  }, [currentSceneIndex, prevIdx, isPlaying, project?.transitionEnabled, project?.transitionDuration]);

  const displayIdx = currentSceneIndex >= 0 ? currentSceneIndex : 0;
  const scene = scenes[displayIdx];
  const prevScene = prevIdx >= 0 && prevIdx < scenes.length ? scenes[prevIdx] : null;
  const progress = computedTotal > 0 ? (currentTime / computedTotal) * 100 : 0;

  const zoomStyle = useMemo(() => {
    if (!scene || !isPlaying) return {};
    if (!project?.zoomEnabled) return {};
    const preset = resolved.zoomSeq[displayIdx];
    if (!preset) return {};
    const css = ZOOM_CSS[preset] || ZOOM_CSS.in;
    const dur = sceneDurations[displayIdx] || 4;
    if (css.anim) return { animation: `${css.anim} ${dur}s ease-in-out forwards` };
    return { animation: `pp-zoom ${dur}s linear forwards`, '--pp-zoom-from': css.from, '--pp-zoom-to': css.to };
  }, [scene?.id, scene?.effectOverrides, isPlaying, displayIdx, sceneDurations, project?.zoomEnabled, resolved]);

  const transId = (project?.transitionEnabled && prevIdx >= 0 && prevIdx < scenes.length)
    ? (resolved.transSeq[prevIdx] || 'fade') : 'fade';
  const transClass = TRANSITION_CSS[transId] || 'pp-tr-fade';
  const transDur = project?.transitionEnabled ? (project.transitionDuration || 0.5) : 0.3;

  // Subtitle styling from project settings
  const subtitleStyle = useMemo(() => {
    if (!project?.subtitlesEnabled) return {};
    const fs = ((project.subtitlesFontSize ?? 48) * 0.28);
    const ol = project.subtitlesOutline ?? 3;
    const olc = project.subtitlesOutlineColor ?? '#000000';
    const sh = project.subtitlesShadow ?? 2;
    const bgOn = project.subtitlesBgEnabled;
    const bgC = project.subtitlesBgColor ?? '#000000';
    const bgO = project.subtitlesBgOpacity ?? 0.5;
    return {
      position: 'absolute', left: `${project.subtitlesX ?? 50}%`, top: `${project.subtitlesY ?? 85}%`,
      transform: 'translate(-50%, -50%)', fontSize: `${fs}px`,
      fontFamily: SUB_FONTS[project.subtitlesStyle] || SUB_FONTS.modern,
      fontWeight: (project.subtitlesStyle === 'bold' || project.subtitlesStyle === 'modern') ? 700 : 400,
      color: project.subtitlesColor ?? '#FFFFFF',
      WebkitTextStroke: ol > 0 ? `${ol * 0.3}px ${olc}` : undefined,
      textShadow: `0 ${sh}px ${sh * 2}px rgba(0,0,0,0.9)`,
      background: bgOn ? `${bgC}${Math.round(bgO * 255).toString(16).padStart(2, '0')}` : undefined,
      padding: bgOn ? '4px 14px' : '4px 12px', borderRadius: bgOn ? '6px' : undefined,
    };
  }, [project?.subtitlesEnabled, project?.subtitlesStyle, project?.subtitlesFontSize,
      project?.subtitlesColor, project?.subtitlesOutline, project?.subtitlesOutlineColor,
      project?.subtitlesShadow, project?.subtitlesBgEnabled, project?.subtitlesBgColor,
      project?.subtitlesBgOpacity, project?.subtitlesX, project?.subtitlesY]);

  // Live color grading via CSS filters
  const gradingStyle = useMemo(() => {
    const f = [];
    const b = project?.ccBrightness ?? 0;
    const c = project?.ccContrast ?? 0;
    const s = project?.ccSaturation ?? 0;
    const t = project?.ccTemperature ?? 0;
    if (b !== 0) f.push(`brightness(${1 + b / 100})`);
    if (c !== 0) f.push(`contrast(${1 + c / 100})`);
    if (s !== 0) f.push(`saturate(${1 + s / 100})`);
    if (t > 0) { f.push(`sepia(${t * 0.003})`); f.push(`hue-rotate(-${t * 0.1}deg)`); }
    if (t < 0) { f.push(`sepia(${-t * 0.0015})`); f.push(`hue-rotate(${-t * 0.15}deg)`); }
    return f.length ? { filter: f.join(' ') } : {};
  }, [project?.ccBrightness, project?.ccContrast, project?.ccSaturation, project?.ccTemperature]);

  // Karaoke subtitles: group words into phrases, highlight current word
  const isKaraokeMode = (project?.subtitlesMode ?? 'karaoke') === 'karaoke';
  const karaokePhrase = useMemo(() => {
    if (!project?.subtitlesEnabled || !wordTimestamps.length || !isKaraokeMode) return null;
    const maxWords = 4;
    const maxGap = 0.6;
    const phrases = [];
    let current = [];
    for (const w of wordTimestamps) {
      if (!w.word?.trim()) continue;
      const gap = current.length > 0 ? w.startSec - current[current.length - 1].endSec : 0;
      if (current.length >= maxWords || (current.length > 0 && gap > maxGap)) {
        phrases.push(current);
        current = [];
      }
      current.push(w);
    }
    if (current.length > 0) phrases.push(current);
    // Find the phrase active at currentTime
    for (const phrase of phrases) {
      const start = phrase[0].startSec;
      const end = phrase[phrase.length - 1].endSec;
      if (currentTime >= start - 0.05 && currentTime <= end + 0.1) return phrase;
    }
    return null;
  }, [wordTimestamps, currentTime, project?.subtitlesEnabled]);

  // Fallback to scene text if no word timestamps
  const subtitleText = (!karaokePhrase && project?.subtitlesEnabled) ? (scene?.voiceText || '') : '';

  // Active CTA at current time (memoized)
  const activeCta = useMemo(() => ctaItems.filter(c => currentTime >= c.timeSec && currentTime < c.timeSec + c.durationSec), [ctaItems, currentTime]);

  const activeOverlays = useMemo(() => overlayItems.filter(o => currentTime >= o.timeSec && currentTime < o.timeSec + o.durationSec).map(o => {
    const elapsed = currentTime - o.timeSec;
    const remaining = (o.timeSec + o.durationSec) - currentTime;
    let phase = 'idle';
    if (elapsed < o.animInDur) phase = 'in';
    else if (remaining < o.animOutDur) phase = 'out';
    return { ...o, phase };
  }), [overlayItems, currentTime]);

  // Scrub: drag on progress bar
  const seekFromEvent = (e) => {
    const r = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    seek(pct * computedTotal);
  };
  const onProgressDown = (e) => {
    setScrubbing(true);
    seekFromEvent(e);
    const onMove = (ev) => seekFromEvent(ev);
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); setScrubbing(false); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Drag CTA on preview to reposition
  const dragCtaOnPreview = (e, cta) => {
    e.preventDefault(); e.stopPropagation();
    const rect = displayRef.current.getBoundingClientRect();
    const onMove = (ev) => {
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      setCtaItems(prev => prev.map(c => c.id === cta.id ? {...c, x, y} : c));
    };
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      api.ctaUpdate(project.id, cta.id, { x: Math.round(x), y: Math.round(y) });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Video preview
  const hasVideoPreview = useVideoPreview && videoSrc && videoReady;
  const isRendering = videoPreviewStatus === 'rendering' || videoPreviewStatus === 'pending';

  // When render done, reload video
  useEffect(() => {
    if (videoPreviewPath && videoPreviewStatus === 'done') {
      setVideoSrc(`/files/${videoPreviewPath}?v=${vpVersion}`);
      setVideoReady(false);
    }
  }, [videoPreviewPath, videoPreviewStatus, vpVersion]);

  useEffect(() => {
    if (videoSrc && videoRef.current) {
      videoRef.current.load();
    }
  }, [videoSrc]);

  // Sync video preview with play/pause
  useEffect(() => {
    if (!videoRef.current || !hasVideoPreview) return;
    if (isPlaying) videoRef.current.play().catch(() => {});
    else videoRef.current.pause();
  }, [isPlaying, hasVideoPreview]);

  // Sync seek
  useEffect(() => {
    if (!videoRef.current || !hasVideoPreview || isPlaying) return;
    videoRef.current.currentTime = currentTime;
  }, [currentTime, hasVideoPreview]);

  return (
    <div className="preview-player">
      {voicePreviewPath && <audio ref={audioRef} src={`/files/${voicePreviewPath}`} preload="metadata" />}
      <div className="pp-display" ref={displayRef} style={gradingStyle}>
        {videoSrc && (
          <video ref={videoRef} src={videoSrc} className="pp-video" muted playsInline preload="auto"
            onCanPlayThrough={() => setVideoReady(true)}
            style={{ display: hasVideoPreview ? 'block' : 'none' }} />
        )}
        {isRendering && (
          <div className="pp-render-overlay">
            <div className="pp-render-overlay-bar">
              <div className={`pp-render-overlay-fill${vpPercent > 0 ? '' : ' pp-render-fill-anim'}`} style={{ width: vpPercent > 0 ? `${vpPercent}%` : '100%' }} />
            </div>
            <div className="pp-render-overlay-text">{vpStep || (vpPercent > 0 ? `Рендер: ${vpPercent}%` : 'Рендерю превью...')}</div>
          </div>
        )}
        {project?.vignetteEnabled && !hasVideoPreview && <div className="pp-vignette" style={{ opacity: project.vignetteIntensity ?? 0.5 }} />}
        {project?.grainEnabled && !hasVideoPreview && <div className="pp-grain" style={{ opacity: (project.grainIntensity ?? 8) / 25 }} />}
        {prevScene?.imagePath && fading && !hasVideoPreview && (
          <img src={`/files/${prevScene.imagePath}`} alt="" className={`pp-img pp-img-out ${transClass}`} style={{ animationDuration: `${transDur}s` }} />
        )}
        {scene?.imagePath && !hasVideoPreview ? (
          <img src={`/files/${scene.imagePath}`} alt="" className={`pp-img${fading ? ' pp-img-in' : ''}`} style={zoomStyle} key={`${scene.id}-${displayIdx}`} />
        ) : (!hasVideoPreview &&
          <div className="pp-placeholder">Сцена {displayIdx + 1}</div>
        )}
        {!hasVideoPreview && karaokePhrase && (
          <div className={`pp-subtitle pp-karaoke`} style={{ ...subtitleStyle, gap: `${(project?.subtitlesSpacing ?? 4) * 0.5}px` }} key={`k-${karaokePhrase[0]?.startSec}`}>
            {karaokePhrase.map((w, i) => {
              const active = currentTime >= w.startSec && currentTime <= w.endSec + 0.05;
              const spoken = currentTime > w.endSec + 0.05;
              const upcoming = currentTime < w.startSec;
              const cls = active ? 'pp-word-active' : spoken ? 'pp-word-spoken' : 'pp-word-upcoming';
              return <span key={i} className={cls}>{w.word}</span>;
            })}
          </div>
        )}
        {!hasVideoPreview && !karaokePhrase && subtitleText && <div className={`pp-subtitle pp-sub-anim-${project?.subtitlesAnimation || 'fade'}`} style={subtitleStyle} key={`s-${displayIdx}`}>{subtitleText}</div>}
        {!hasVideoPreview && activeCta.map(c => {
          const isVideo = c.imagePath && /\.(mp4|webm|mov)$/i.test(c.imagePath);
          const isImage = c.imagePath && !isVideo;
          return (
            <div key={c.id} className={`pp-cta pp-cta-anim-${c.animation}`} style={{ left: `${c.x}%`, top: `${c.y}%`, transform: `translate(-50%, -50%) scale(${c.scale})`, '--cta-bg': c.imagePath ? 'transparent' : c.color, background: c.imagePath ? 'none' : undefined, padding: c.imagePath ? 0 : undefined, boxShadow: c.imagePath ? 'none' : undefined }} onMouseDown={(e) => dragCtaOnPreview(e, c)} onWheel={(e) => { e.preventDefault(); const delta = e.deltaY > 0 ? -0.1 : 0.1; const ns = Math.max(0.2, Math.min(3, (c.scale || 1) + delta)); setCtaItems(prev => prev.map(i => i.id === c.id ? {...i, scale: ns} : i)); clearTimeout(scaleTimerRef.current); scaleTimerRef.current = setTimeout(() => api.ctaUpdate(project.id, c.id, { scale: Math.round(ns * 10) / 10 }), 300); }}>
              {isVideo && <video src={`/files/${c.imagePath}`} autoPlay loop muted style={{ maxWidth: 200, maxHeight: 140, borderRadius: 8 }} />}
              {isImage && <img src={`/files/${c.imagePath}`} alt="" style={{ maxWidth: 200, maxHeight: 140, borderRadius: 8 }} />}
              {!c.imagePath && <>{c.emoji && <span className="pp-cta-emoji">{c.emoji}</span>}<span>{c.text}</span></>}
            </div>
          );
        })}
        {!hasVideoPreview && <div className="pp-scene-label">Сцена {displayIdx + 1} / {scenes.length}</div>}
        {!hasVideoPreview && activeOverlays.map(o => {
          if (o.type === 'audio') return null;
          const animClass = o.phase === 'in' ? `ov-in-${o.animIn}` : o.phase === 'out' ? `ov-out-${o.animOut}` : (o.animIdle !== 'none' ? `ov-idle-${o.animIdle}` : '');
          const baseStyle = { left: `${o.x}%`, top: `${o.y}%`, transform: `translate(-50%, -50%) scale(${o.scale}) rotate(${o.rotation}deg)`, '--ov-in-dur': `${o.animInDur}s`, '--ov-out-dur': `${o.animOutDur}s` };
          if (o.type === 'text') {
            const textStyle = { ...baseStyle, fontFamily: o.fontFamily, fontSize: `${o.fontSize * 0.28}px`, color: o.fontColor, fontWeight: o.fontWeight, WebkitTextStroke: o.outlineWidth > 0 ? `${o.outlineWidth * 0.3}px ${o.outlineColor}` : undefined, textShadow: o.shadowSize > 0 ? `0 ${o.shadowSize}px ${o.shadowSize * 2}px rgba(0,0,0,0.8)` : undefined, background: o.bgEnabled ? `${o.bgColor}${Math.round(o.bgOpacity * 255).toString(16).padStart(2, '0')}` : undefined, padding: o.bgEnabled ? '4px 14px' : undefined, borderRadius: o.bgEnabled ? `${o.bgRadius}px` : undefined };
            return <div key={o.id} className={`pp-overlay pp-overlay-text ${animClass}`} style={textStyle}>{o.text}</div>;
          }
          const isVideo = o.filePath && /\.(mp4|webm|mov)$/i.test(o.filePath);
          return (
            <div key={o.id} className={`pp-overlay ${animClass}`} style={baseStyle}>
              {isVideo ? <video src={`/files/${o.filePath}`} autoPlay loop muted style={{ maxWidth: 180, maxHeight: 120, borderRadius: 4 }} /> : <img src={`/files/${o.filePath}`} alt="" style={{ maxWidth: 180, maxHeight: 120, borderRadius: 4 }} />}
            </div>
          );
        })}
      </div>
      <div className="pp-controls">
        <button className="pp-btn" onClick={isPlaying ? pause : play} title={isPlaying ? 'Пауза' : 'Воспроизвести'}>
          <Icon name={isPlaying ? 'pause' : 'play'} size={16} />
        </button>
        <div className="pp-progress" ref={progressRef} onMouseDown={onProgressDown}>
          <div className="pp-progress-fill" style={{ width: `${progress}%` }} />
          <div className="pp-progress-thumb" style={{ left: `${progress}%` }} />
        </div>
        <span className="pp-time">{fmt(currentTime)} / {fmt(computedTotal)}</span>
        {onRenderPreview && (
          <button className={`pp-btn pp-prerender-btn${isRendering ? ' pp-rendering' : ''}`} onClick={() => { onRenderPreview(); setUseVideoPreview(true); }} disabled={isRendering} title="Собрать превью (как будет на финале)">
            {isRendering ? `${vpPercent > 0 ? vpPercent + '%' : '...'}` : 'Пререндер'}
          </button>
        )}
        {videoPreviewPath && (
          <button className={`pp-btn pp-mode-btn${useVideoPreview ? ' pp-mode-active' : ''}`} onClick={() => setUseVideoPreview(v => !v)} title={useVideoPreview ? 'Видео-превью (как финал) — нажми для CSS' : 'CSS-превью — нажми для видео'}>
            {useVideoPreview ? 'V' : 'C'}
          </button>
        )}
        {onPatch && (
          <button
            className={`pp-btn pp-cc-btn${showSubSettings ? ' pp-cc-active' : ''}${project?.subtitlesEnabled ? ' pp-cc-on' : ''}`}
            onClick={(e) => {
              if (e.shiftKey) { setShowSubSettings(v => !v); return; }
              onPatch({ subtitlesEnabled: !project?.subtitlesEnabled });
            }}
            onContextMenu={(e) => { e.preventDefault(); setShowSubSettings(v => !v); }}
            title={`${project?.subtitlesEnabled ? 'Выключить субтитры' : 'Включить субтитры'} · правый клик / Shift+клик — настройки`}
          >CC</button>
        )}
      </div>
      {showSubSettings && onPatch && <SubtitlesPanel project={project} onPatch={onPatch} />}
    </div>
  );
}

function fmt(sec) { if (!sec || !isFinite(sec)) return '0:00'; return `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`; }
