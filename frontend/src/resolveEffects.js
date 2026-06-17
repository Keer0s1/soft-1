// Фронтенд-зеркало backend/src/lib/effects.ts:resolveEffects
// Детерминированный псевдо-рандом по projectId, чтобы превью совпадало с рендером.

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickSequence(pool, count, rand) {
  if (!pool.length) return [];
  const out = [];
  let prev = null;
  for (let i = 0; i < count; i++) {
    let idx = Math.floor(rand() * pool.length);
    let choice = pool[idx];
    if (pool.length > 1 && choice === prev) {
      choice = pool[(idx + 1) % pool.length];
    }
    out.push(choice);
    prev = choice;
  }
  return out;
}

const ZOOM_IDS = new Set([
  'in','out','left','right','up','down','inUp','inDown','slowDrift','breathe','cinematic'
]);
const TRANS_IDS = new Set([
  'fade','fadeblack','fadewhite','dissolve',
  'wipeleft','wiperight','wipeup','wipedown',
  'slideleft','slideright','slideup','slidedown',
  'smoothleft','smoothright','smoothup','smoothdown',
  'circleopen','circleclose','radial','pixelize',
  'diagbl','diagbr','diagtl','diagtr',
  'hlslice','vuslice','vdslice',
  'horzopen','vertopen','horzclose','vertclose',
]);

function validZoomPresets(arr) {
  const list = Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && ZOOM_IDS.has(x)) : [];
  return list.length ? list : ['in'];
}
function validTransitionPresets(arr) {
  const list = Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && TRANS_IDS.has(x)) : [];
  return list.length ? list : ['fade'];
}

export function resolveEffectsFront(scenes, project) {
  const seed = hashString(project?.id || 'default');
  const rand = seededRandom(seed);

  const zoomPool = validZoomPresets(project?.zoomPresets);
  const transPool = validTransitionPresets(project?.transitionPresets);
  const randomZoom = pickSequence(zoomPool, scenes.length, rand);
  const randomTrans = pickSequence(transPool, Math.max(0, scenes.length - 1), rand);

  const zoomSeq = [];
  const zoomIntensities = [];
  const zoomSpeeds = [];
  const zoomEasings = [];
  const zoomFocusX = [];
  const zoomFocusY = [];
  const zoomShakes = [];
  const transSeq = [];

  for (let i = 0; i < scenes.length; i++) {
    const ov = scenes[i].effectOverrides;
    if (!project?.zoomEnabled || ov?.disableZoom) {
      zoomSeq.push(null);
    } else {
      zoomSeq.push(ov?.zoom && ZOOM_IDS.has(ov.zoom) ? ov.zoom : randomZoom[i]);
    }
    zoomIntensities.push(ov?.zoomIntensity ?? project?.zoomIntensity ?? 0.15);
    zoomSpeeds.push(ov?.speed ?? project?.zoomSpeed ?? 1.0);
    zoomEasings.push(ov?.easing ?? project?.zoomEasing ?? 'linear');
    zoomFocusX.push(ov?.focusX ?? 50);
    zoomFocusY.push(ov?.focusY ?? 50);
    zoomShakes.push(ov?.cameraShake ?? project?.cameraShake ?? 0);
    if (i < scenes.length - 1) {
      if (!project?.transitionEnabled || ov?.disableTransition) {
        transSeq.push(null);
      } else {
        transSeq.push(ov?.transition && TRANS_IDS.has(ov.transition) ? ov.transition : randomTrans[i]);
      }
    }
  }

  return { zoomSeq, zoomIntensities, zoomSpeeds, zoomEasings, zoomFocusX, zoomFocusY, zoomShakes, transSeq };
}
