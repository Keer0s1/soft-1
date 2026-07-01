import { useRef, useState } from 'react';
import { api } from '../api.js';

// Разбиваем на непустые строки (одна строка = одна сцена).
const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// Конвертация File → base64 data-URI с порогом размера (для фоток).
function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = (e) => resolve(e.target.result);
    r.onerror = () => reject(new Error(`Не удалось прочитать ${file.name}`));
    r.readAsDataURL(file);
  });
}

// Натуральная сортировка по имени файла — чтобы scene_01.jpg шла раньше scene_10.jpg.
function naturalSort(a, b) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function TextFileZone({ label, hint, fileName, onText }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);

  function read(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = (e) => onText(e.target.result ?? '', file.name);
    r.readAsText(file, 'utf-8');
  }
  return (
    <div
      className={`import-dropzone${drag ? ' active' : ''}`}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}
    >
      <span className="import-drop-icon">📄</span>
      <div>
        <b>{label}</b>
        {fileName ? <span className="muted small"> — {fileName} ✓</span> : <span className="muted small"> — {hint}</span>}
      </div>
      <input ref={ref} type="file" accept=".txt,text/plain" hidden
        onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

function ImageZone({ images, onAdd, onClear }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);

  return (
    <div
      className={`import-dropzone import-dropzone-images${drag ? ' active' : ''}`}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onAdd(e.dataTransfer.files); }}
    >
      <span className="import-drop-icon">🖼</span>
      <div className="import-image-info">
        <b>Фотки сцен (опционально)</b>
        {images.length === 0
          ? <span className="muted small"> — перетащи или выбери (можно сразу несколько)</span>
          : (
            <>
              <span className="muted small"> — {images.length} шт. ✓</span>
              <button type="button" className="import-clear" onClick={(e) => { e.stopPropagation(); onClear(); }}>
                очистить
              </button>
            </>
          )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { onAdd(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}

export default function ImportDialog({ projectId, onImported, onClose }) {
  const [speechText, setSpeechText] = useState('');
  const [promptsText, setPromptsText] = useState('');
  const [speechName, setSpeechName] = useState('');
  const [promptsName, setPromptsName] = useState('');
  const [images, setImages] = useState([]); // [{ name, dataUri, sizeKb }]
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  // Режим «Большая история»: видеоряд не привязан к словам. Если строк
  // сценария больше, чем промтов — лишние равномерно растворяются (каждая
  // делится пополам: левая половина → к предыдущей, правая → к следующей).
  const [bigStory, setBigStory] = useState(false);

  async function addImages(fileList) {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/'))
      .sort(naturalSort);
    if (incoming.length === 0) return;

    const tooBig = incoming.find((f) => f.size > 15 * 1024 * 1024);
    if (tooBig) {
      setError(`${tooBig.name} больше 15 МБ — сожми перед загрузкой`);
      return;
    }
    setError('');
    try {
      const next = await Promise.all(
        incoming.map(async (f) => ({
          name: f.name,
          dataUri: await fileToDataUri(f),
          sizeKb: Math.round(f.size / 1024),
        })),
      );
      setImages((prev) => [...prev, ...next]);
    } catch (e) {
      setError(e.message);
    }
  }

  const sLines = lines(speechText);
  const pLines = lines(promptsText);
  const hasImages = images.length > 0;

  // ── Режимы импорта ─────────────────────────────────────────────
  // 1) с фотками: 1 строка речи = 1 фотка (промты опциональны)
  // 2) без фоток: 1 строка речи = 1 строка промта (старый flow)
  let pairs;
  let countOk;
  let modeNote;

  if (hasImages) {
    const max = Math.max(sLines.length, images.length);
    pairs = Array.from({ length: max }, (_, i) => ({
      s: sLines[i],
      p: pLines[i],
      img: images[i],
      bad: sLines[i] === undefined || images[i] === undefined,
    }));
    countOk = sLines.length > 0 && sLines.length === images.length;
    modeNote = `Речей: ${sLines.length} · Фоток: ${images.length}` +
      (pLines.length ? ` · Промтов: ${pLines.length}` : '') +
      (countOk ? ' — совпадает ✓' : ' — речь и фотки должны совпадать по количеству');
  } else if (bigStory) {
    // В режиме «большая история» главное — промты. Строк должно быть ≥ промтов.
    const max = Math.max(sLines.length, pLines.length);
    pairs = Array.from({ length: max }, (_, i) => ({
      s: sLines[i],
      p: pLines[i],
      img: null,
      bad: pLines[i] === undefined, // промт обязателен; речь подстроится
    }));
    countOk = pLines.length > 0 && sLines.length > 0;
    if (!sLines.length || !pLines.length) {
      modeNote = `Речей: ${sLines.length} · Промтов: ${pLines.length}`;
    } else if (sLines.length === pLines.length) {
      modeNote = `Речей: ${sLines.length} · Промтов: ${pLines.length} — совпадает ✓`;
    } else if (sLines.length < pLines.length) {
      modeNote = `Речей: ${sLines.length} · Промтов: ${pLines.length} — длинные строки разрежутся на ${pLines.length - sLines.length} дополнительных кусков ✓`;
    } else {
      modeNote = `Речей: ${sLines.length} · Промтов: ${pLines.length} — лишние ${sLines.length - pLines.length} строк растворятся в соседних ✓`;
    }
  } else {
    const max = Math.max(sLines.length, pLines.length);
    pairs = Array.from({ length: max }, (_, i) => ({
      s: sLines[i],
      p: pLines[i],
      img: null,
      bad: sLines[i] === undefined || pLines[i] === undefined,
    }));
    countOk = sLines.length > 0 && pLines.length > 0 && sLines.length === pLines.length;
    modeNote = `Речей: ${sLines.length} · Промтов: ${pLines.length}` +
      (countOk ? ' — совпадает ✓' : (sLines.length || pLines.length ? ' — не совпадает' : ''));
  }

  const ready = countOk && !importing;

  async function doImport() {
    setError('');
    setImporting(true);
    try {
      if (hasImages) {
        const scenes = sLines.map((voiceText, i) => ({
          voiceText,
          imagePrompt: pLines[i] ?? '',
          imageDataUri: images[i]?.dataUri,
        }));
        await api.replaceScenesWithImages(projectId, scenes);
      } else {
        const { scenes } = await api.parseFiles(projectId, speechText, promptsText, { bigStory });
        await api.replaceScenes(projectId, scenes);
      }
      onImported?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Импорт сценария</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          <b>1 строка = 1 сцена.</b> Загрузите файл речи. Дальше на выбор:
          приложите свои фотки <b>или</b> файл промтов для генерации.
        </p>

        <div className="import-cols">
          <TextFileZone
            label="Речь (.txt)"
            hint="перетащи или выбери"
            fileName={speechName}
            onText={(t, n) => { setSpeechText(t); setSpeechName(n); }}
          />
          <TextFileZone
            label={hasImages ? 'Промты (.txt, необязательно)' : 'Промты (.txt)'}
            hint="перетащи или выбери"
            fileName={promptsName}
            onText={(t, n) => { setPromptsText(t); setPromptsName(n); }}
          />
        </div>

        <ImageZone
          images={images}
          onAdd={addImages}
          onClear={() => setImages([])}
        />

        {!hasImages && (
          <label className="import-bigstory" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '14px 0 4px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={bigStory}
              onChange={(e) => setBigStory(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <b>Большая история</b>
              <span className="muted small" style={{ display: 'block', marginTop: 2 }}>
                Видеоряд не привязан к словам. Количество промтов = количество
                сцен. Если строк сценария <b>больше</b> — лишние склеятся с
                соседями. Если <b>меньше</b> — длинные строки разрежутся
                пополам, чтобы заполнить недостающие сцены. Порядок сценария
                сохраняется.
              </span>
            </span>
          </label>
        )}

        {/* Можно и вставить текстом, если без файлов */}
        <details className="import-paste">
          <summary className="muted small">…или вставить текстом</summary>
          <div className="import-cols">
            <label>Речь (строка = сцена)
              <textarea rows={6} value={speechText} onChange={(e) => setSpeechText(e.target.value)} />
            </label>
            <label>Промты (строка = промт)
              <textarea rows={6} value={promptsText} onChange={(e) => setPromptsText(e.target.value)} />
            </label>
          </div>
        </details>

        {(sLines.length > 0 || pLines.length > 0 || hasImages) && (
          <div className={`import-check${countOk ? ' ok' : ' bad'}`}>
            {modeNote}
          </div>
        )}

        {pairs.length > 0 && (
          <div className="import-preview">
            {pairs.map((p, i) => (
              <div key={i} className={`import-pair${p.bad ? ' bad' : ''}`}>
                <span className="ip-num">{i + 1}</span>
                <span className="ip-voice">🎙 {p.s ?? <em className="ip-missing">нет речи</em>}</span>
                {hasImages ? (
                  <span className="ip-image">
                    {p.img
                      ? <img src={p.img.dataUri} alt={p.img.name} className="ip-thumb" />
                      : <em className="ip-missing">нет фото</em>}
                  </span>
                ) : (
                  <span className="ip-prompt">🖼 {p.p ?? <em className="ip-missing">нет промта</em>}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <div className="error-box">{error}</div>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={importing}>Отмена</button>
          <button onClick={doImport} disabled={!ready}>
            {importing
              ? 'Импортирую…'
              : `Импортировать${countOk ? ` (${bigStory && !hasImages ? pLines.length : sLines.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
