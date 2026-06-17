import { useRef, useEffect, useState, useCallback } from 'react';

const SUB_FONTS = {
  modern: 'Arial, sans-serif',
  classic: 'Times New Roman, serif',
  bold: 'Impact, sans-serif',
  minimal: 'Arial, sans-serif',
};

// Парсим .cube LUT файл -> 3D таблицу
function parseCubeLUT(text) {
  const lines = text.split('\n');
  let size = 0;
  const data = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('TITLE')) continue;
    if (trimmed.startsWith('LUT_3D_SIZE')) {
      size = parseInt(trimmed.split(/\s+/)[1], 10);
      continue;
    }
    if (trimmed.startsWith('DOMAIN_MIN') || trimmed.startsWith('DOMAIN_MAX')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!isNaN(r)) data.push(r, g, b);
    }
  }
  if (size === 0 || data.length < size * size * size * 3) return null;
  return { size, data };
}

// Применяем 3D LUT к пикселю (трилинейная интерполяция)
function applyLUT(lut, r, g, b) {
  const s = lut.size - 1;
  const ri = (r / 255) * s;
  const gi = (g / 255) * s;
  const bi = (b / 255) * s;

  const r0 = Math.floor(ri), r1 = Math.min(r0 + 1, s);
  const g0 = Math.floor(gi), g1 = Math.min(g0 + 1, s);
  const b0 = Math.floor(bi), b1 = Math.min(b0 + 1, s);

  const rf = ri - r0, gf = gi - g0, bf = bi - b0;
  const sz = lut.size;

  function sample(ri, gi, bi) {
    const idx = (bi * sz * sz + gi * sz + ri) * 3;
    return [lut.data[idx], lut.data[idx + 1], lut.data[idx + 2]];
  }

  // Trilinear interpolation
  const c000 = sample(r0, g0, b0);
  const c100 = sample(r1, g0, b0);
  const c010 = sample(r0, g1, b0);
  const c110 = sample(r1, g1, b0);
  const c001 = sample(r0, g0, b1);
  const c101 = sample(r1, g0, b1);
  const c011 = sample(r0, g1, b1);
  const c111 = sample(r1, g1, b1);

  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c00 = c000[ch] * (1 - rf) + c100[ch] * rf;
    const c01 = c001[ch] * (1 - rf) + c101[ch] * rf;
    const c10 = c010[ch] * (1 - rf) + c110[ch] * rf;
    const c11 = c011[ch] * (1 - rf) + c111[ch] * rf;
    const c0 = c00 * (1 - gf) + c10 * gf;
    const c1 = c01 * (1 - gf) + c11 * gf;
    out[ch] = c0 * (1 - bf) + c1 * bf;
  }
  return [
    Math.round(Math.min(255, Math.max(0, out[0] * 255))),
    Math.round(Math.min(255, Math.max(0, out[1] * 255))),
    Math.round(Math.min(255, Math.max(0, out[2] * 255))),
  ];
}

// Строим lookup-таблицу для быстрого применения контраста/яркости
function buildCurveLUT(brightness, contrast) {
  const table = new Uint8Array(256);
  const b = brightness / 100;
  const c = contrast / 100;
  const factor = (1 + c) / (1.001 - c);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v = factor * (v - 0.5) + 0.5 + b;
    table[i] = Math.round(Math.min(255, Math.max(0, v * 255)));
  }
  return table;
}

export default function GradingPreview({ project, sampleImage, sampleText, onPatch }) {
  const canvasRef = useRef(null);
  const subRef = useRef(null);
  const imgRef = useRef(null);
  const [lutData, setLutData] = useState(null);
  const [lutFile, setLutFile] = useState(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Загружаем LUT при смене файла
  useEffect(() => {
    if (!project.lutFile) { setLutData(null); setLutFile(null); return; }
    if (project.lutFile === lutFile) return;
    setLutFile(project.lutFile);
    fetch(`/api/meta/luts/${encodeURIComponent(project.lutFile)}`)
      .then((r) => r.ok ? r.text() : null)
      .then((text) => {
        if (text) setLutData(parseCubeLUT(text));
        else setLutData(null);
      })
      .catch(() => setLutData(null));
  }, [project.lutFile]);

  // Загружаем картинку
  useEffect(() => {
    if (!sampleImage) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; setImgLoaded(true); };
    img.src = sampleImage;
    setImgLoaded(false);
  }, [sampleImage]);

  // Рендерим canvas при изменении любого параметра
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;

    // Рисуем картинку (cover)
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const canvasAspect = w / h;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (imgAspect > canvasAspect) {
      sw = img.naturalHeight * canvasAspect;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / canvasAspect;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

    // Пиксельные операции
    const imageData = ctx.getImageData(0, 0, w, h);
    const pixels = imageData.data;

    const brightness = project.ccBrightness ?? 0;
    const contrast = project.ccContrast ?? 0;
    const saturation = project.ccSaturation ?? 0;
    const temperature = project.ccTemperature ?? 0;
    const hasCC = brightness !== 0 || contrast !== 0 || saturation !== 0 || temperature !== 0;
    const hasLut = !!lutData && !!project.lutFile;

    if (hasLut || hasCC) {
      const curve = (brightness !== 0 || contrast !== 0) ? buildCurveLUT(brightness, contrast) : null;
      const satMul = 1 + saturation / 100;
      const tempShift = temperature * 0.4; // мягкий сдвиг

      for (let i = 0; i < pixels.length; i += 4) {
        let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];

        // LUT
        if (hasLut) {
          const [lr, lg, lb] = applyLUT(lutData, r, g, b);
          r = lr; g = lg; b = lb;
        }

        // Brightness + Contrast
        if (curve) {
          r = curve[r]; g = curve[g]; b = curve[b];
        }

        // Saturation
        if (saturation !== 0) {
          const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          r = Math.min(255, Math.max(0, Math.round(gray + (r - gray) * satMul)));
          g = Math.min(255, Math.max(0, Math.round(gray + (g - gray) * satMul)));
          b = Math.min(255, Math.max(0, Math.round(gray + (b - gray) * satMul)));
        }

        // Temperature
        if (temperature !== 0) {
          r = Math.min(255, Math.max(0, Math.round(r + tempShift)));
          b = Math.min(255, Math.max(0, Math.round(b - tempShift)));
        }

        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
      }
      ctx.putImageData(imageData, 0, 0);
    }

    // Grain
    if (project.grainEnabled) {
      const intensity = (project.grainIntensity ?? 8) / 25;
      const grainData = ctx.createImageData(w, h);
      const gp = grainData.data;
      for (let i = 0; i < gp.length; i += 4) {
        const noise = (Math.random() - 0.5) * 255 * intensity;
        gp[i] = 128 + noise;
        gp[i + 1] = 128 + noise;
        gp[i + 2] = 128 + noise;
        gp[i + 3] = Math.round(intensity * 80);
      }
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = w;
      tmpCanvas.height = h;
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.putImageData(grainData, 0, 0);
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(tmpCanvas, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Vignette
    if (project.vignetteEnabled) {
      const v = project.vignetteIntensity ?? 0.5;
      const gradient = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.7);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(0,0,0,${v * 0.85})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }
  }, [project, imgLoaded, lutData]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  if (!sampleImage) return null;

  const subs = project.subtitlesEnabled;
  const subX = project.subtitlesX ?? 50;
  const subY = project.subtitlesY ?? 85;
  const subColor = project.subtitlesColor ?? '#FFFFFF';
  const subOutline = project.subtitlesOutline ?? 3;
  const subOutlineColor = project.subtitlesOutlineColor ?? '#000000';
  const subShadow = project.subtitlesShadow ?? 2;
  const subAnim = project.subtitlesAnimation ?? 'fade';
  const subBg = project.subtitlesBgEnabled;
  const subBgColor = project.subtitlesBgColor ?? '#000000';
  const subBgOpacity = project.subtitlesBgOpacity ?? 0.5;
  const fontSize = (project.subtitlesFontSize ?? 48) * 0.35;
  const fontFamily = SUB_FONTS[project.subtitlesStyle] ?? SUB_FONTS.modern;
  const fontWeight = (project.subtitlesStyle === 'modern' || project.subtitlesStyle === 'bold') ? 700 : 400;

  const ANIM_CLASSES = { fade: 'sub-anim-fade', slideUp: 'sub-anim-slide', scale: 'sub-anim-scale', typewriter: 'sub-anim-type' };

  function playAnim() {
    const el = subRef.current;
    if (!el) return;
    const cls = ANIM_CLASSES[subAnim] || ANIM_CLASSES.fade;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 2600);
  }

  return (
    <div className="grading-preview-wrap">
      <div className="grading-preview">
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className="grading-preview-img"
        />

        {/* Subtitle preview — поверх canvas */}
        {subs && (
          <div
            ref={subRef}
            className="grading-subtitle"
            style={{
              left: `${subX}%`,
              top: `${subY}%`,
              transform: 'translate(-50%, -50%)',
              fontSize: `${fontSize}px`,
              fontFamily,
              fontWeight,
              color: subColor,
              WebkitTextStroke: subOutline > 0 ? `${subOutline * 0.3}px ${subOutlineColor}` : undefined,
              textShadow: subShadow > 0 ? `0 ${subShadow}px ${subShadow * 3}px rgba(0,0,0,${Math.min(1, subShadow * 0.3)})` : 'none',
              backgroundColor: subBg ? `${subBgColor}${Math.round(subBgOpacity * 255).toString(16).padStart(2, '0')}` : undefined,
              padding: subBg ? '4px 12px' : undefined,
              borderRadius: subBg ? '6px' : undefined,
              pointerEvents: 'none',
            }}
          >
            {sampleText || 'Субтитры'}
          </div>
        )}

        <span className="grading-hint">Live Preview</span>
      </div>

      {/* Controls under preview */}
      {subs && (
        <div className="grading-controls">
          <div className="grading-xy">
            <label className="fx-slider">
              X: {subX}%
              <input type="range" min="5" max="95" step="1" value={subX}
                onChange={(e) => onPatch({ subtitlesX: Number(e.target.value) })} />
            </label>
            <label className="fx-slider">
              Y: {subY}%
              <input type="range" min="5" max="95" step="1" value={subY}
                onChange={(e) => onPatch({ subtitlesY: Number(e.target.value) })} />
            </label>
          </div>
          <div className="grading-pos-btns">
            <button className="ghost small" onClick={playAnim}>▶ Анимация</button>
            <button className="ghost small" onClick={() => onPatch({ subtitlesX: 50, subtitlesY: 15 })}>Верх</button>
            <button className="ghost small" onClick={() => onPatch({ subtitlesX: 50, subtitlesY: 50 })}>Центр</button>
            <button className="ghost small" onClick={() => onPatch({ subtitlesX: 50, subtitlesY: 85 })}>Низ</button>
          </div>
        </div>
      )}
    </div>
  );
}
