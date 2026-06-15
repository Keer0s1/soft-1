import { useRef, useState } from 'react';
import { api } from '../api.js';

// Импорт двух .txt файлов: один — речь, другой — промты. Матчинг по строкам:
// строка N речи + строка N промта = сцена N. Пустые строки игнорируются.
const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function FileZone({ label, hint, fileName, onText }) {
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

export default function ImportDialog({ projectId, onImported, onClose }) {
  const [speechText, setSpeechText] = useState('');
  const [promptsText, setPromptsText] = useState('');
  const [speechName, setSpeechName] = useState('');
  const [promptsName, setPromptsName] = useState('');
  const [error, setError] = useState('');

  const sLines = lines(speechText);
  const pLines = lines(promptsText);
  const countMismatch = sLines.length > 0 && pLines.length > 0 && sLines.length !== pLines.length;
  const ready = sLines.length > 0 && pLines.length > 0 && !countMismatch;
  const previewPairs = sLines.slice(0, 5).map((s, i) => ({ s, p: pLines[i] ?? '—' }));

  async function doImport() {
    setError('');
    try {
      const { scenes } = await api.parseFiles(projectId, speechText, promptsText);
      onImported(scenes);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Импорт сценария (два файла)</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          В каждом файле <b>1 строка = 1 сцена</b>. Строка N речи совпадёт со строкой N промта.
          Пустые строки игнорируются.
        </p>

        <div className="import-cols">
          <FileZone label="Файл речи (.txt)" hint="перетащи или выбери" fileName={speechName}
            onText={(t, n) => { setSpeechText(t); setSpeechName(n); }} />
          <FileZone label="Файл промтов (.txt)" hint="перетащи или выбери" fileName={promptsName}
            onText={(t, n) => { setPromptsText(t); setPromptsName(n); }} />
        </div>

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

        {/* Счётчик и предпросмотр пар */}
        {(sLines.length > 0 || pLines.length > 0) && (
          <div className={`import-check${countMismatch ? ' bad' : ' ok'}`}>
            Речей: <b>{sLines.length}</b> · Промтов: <b>{pLines.length}</b>
            {countMismatch && ' — не совпадает! Исправь, иначе сцены съедут.'}
            {ready && ' — совпадает ✓'}
          </div>
        )}
        {ready && (
          <div className="import-preview">
            {previewPairs.map((p, i) => (
              <div key={i} className="import-pair">
                <span className="ip-num">{i + 1}</span>
                <span className="ip-voice">🎙 {p.s}</span>
                <span className="ip-prompt">🖼 {p.p}</span>
              </div>
            ))}
            {sLines.length > 5 && <div className="muted small">…и ещё {sLines.length - 5}</div>}
          </div>
        )}

        {error && <div className="error-box">{error}</div>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Отмена</button>
          <button onClick={doImport} disabled={!ready}>Импортировать {ready ? `(${sLines.length})` : ''}</button>
        </div>
      </div>
    </div>
  );
}
