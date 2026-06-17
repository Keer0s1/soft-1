import { useState, useCallback, useRef, useEffect } from 'react';

export function useTimelineState(scenes) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const audioRef = useRef(null);
  const rafRef = useRef(null);
  const playheadRef = useRef(null);
  const timeRef = useRef(0);

  const durations = scenes.map((s) => {
    if (s.durationOverride && s.durationOverride > 0) return s.durationOverride;
    return Math.max(s.voiceText?.length || 1, 1);
  });
  const totalChars = durations.reduce((a, b) => a + b, 0);

  const totalDuration = audioRef.current?.duration || null;
  const sceneDurations = totalDuration
    ? durations.map((d) => (totalDuration * d) / totalChars)
    : durations.map((d) => (d / totalChars) * (scenes.length * 4));

  const boundaries = [];
  let acc = 0;
  for (const d of sceneDurations) {
    boundaries.push(acc);
    acc += d;
  }
  boundaries.push(acc);
  const computedTotal = acc;

  const currentSceneIndex = boundaries.findIndex((b, i) =>
    i < boundaries.length - 1 && currentTime >= b && currentTime < boundaries[i + 1]
  );

  const updatePlayhead = useCallback((t) => {
    if (playheadRef.current && computedTotal > 0) {
      const pct = (t / computedTotal) * 100;
      playheadRef.current.style.left = `${pct}%`;
    }
  }, [computedTotal]);

  const play = useCallback(() => {
    // If at the end, restart from beginning
    if (timeRef.current >= computedTotal - 0.1) {
      timeRef.current = 0;
      setCurrentTime(0);
      if (playheadRef.current) playheadRef.current.style.left = '0%';
      if (audioRef.current) audioRef.current.currentTime = 0;
    } else if (audioRef.current) {
      audioRef.current.currentTime = timeRef.current;
    }
    if (audioRef.current) audioRef.current.play();
    setIsPlaying(true);
  }, [computedTotal]);

  const pause = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
    setIsPlaying(false);
    setCurrentTime(timeRef.current);
  }, []);

  const seek = useCallback((t) => {
    timeRef.current = t;
    setCurrentTime(t);
    updatePlayhead(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  }, [updatePlayhead]);

  const toggleSelect = useCallback((id, multi) => {
    setSelectedIds((prev) => {
      if (multi) {
        return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      }
      return prev.includes(id) && prev.length === 1 ? [] : [id];
    });
  }, []);

  const selectRange = useCallback((startIdx, endIdx) => {
    const from = Math.min(startIdx, endIdx);
    const to = Math.max(startIdx, endIdx);
    setSelectedIds(scenes.slice(from, to + 1).map((s) => s.id));
  }, [scenes]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    let lastFrameTime = performance.now();
    const tick = (now) => {
      if (audioRef.current) {
        timeRef.current = audioRef.current.currentTime;
        if (audioRef.current.ended) {
          setIsPlaying(false);
          setCurrentTime(timeRef.current);
          return;
        }
      } else {
        const dt = (now - lastFrameTime) / 1000;
        lastFrameTime = now;
        timeRef.current += dt;
        if (timeRef.current >= computedTotal) {
          timeRef.current = computedTotal;
          setIsPlaying(false);
          setCurrentTime(computedTotal);
          updatePlayhead(computedTotal);
          return;
        }
      }
      updatePlayhead(timeRef.current);
      // Update React state at 10fps for scene index (not every frame)
      if (Math.floor(now / 100) !== Math.floor((now - 16) / 100)) {
        setCurrentTime(timeRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    lastFrameTime = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, computedTotal, updatePlayhead]);

  return {
    currentTime, isPlaying, selectedIds, audioRef, playheadRef, timeRef,
    sceneDurations, boundaries, computedTotal, currentSceneIndex,
    play, pause, seek, toggleSelect, selectRange, setSelectedIds, updatePlayhead,
  };
}
