import { useRef, useState } from 'react';
import { api } from '../api.js';

// Импорт сцен из вставленного текста или .txt-файла (drag-and-drop / кнопка).
// Способ 1: один сценарий с маркерами «IMG: промт» после каждого куска.
// Способ 2: сценарий (абзацы через пустую строку) + отдельный список промтов.
export default function ImportDialog({ projectId, onImported, onClose }) {
  const [scriptText, setScriptText]   = useState('');
  const [promptsText, setPromptsText] = useState('');
  const [error, setError]             = useState('');
  const [fileName, setFileName]       = useState('');
  const [dragging, setDragging]       = useState(false);

  const fileRef = useRef(null);

  function readFile(file) {
    if (!file) return;
    if (!file.name.endsWith('.txt') && !file.type.includes('text')) {
      setError('Нужен .txt файл.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setScriptText(ev.target.result ?? '');
      setFileName(file.name);
      setError('');
    };
    reader.onerror = () => setError('Не удалось прочитать файл.');
    reader.readAsText(file, 'utf-8');
  }

  function handleFile(e) {
    readFile(e.target.files?.[0]);
    e.target.value = '';
  }

  // Drag-and-drop на всю зону
  function onDragOver(e) {
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave(e) {
    // только если вышли за пределы drop-зоны
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  }
  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    readFile(e.dataTransfer.files?.[0]);
  }

  async function doImport() {
    setError('');
    try {
      const { scenes } = await api.parseScript(projectId, scriptText, promptsText || undefined);
      onImported(scenes);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal import-modal${dragging ? ' import-drag-over' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <h3>Импорт сценария</h3>

        {/* Drag-and-drop зона */}
        <div
          className={`import-dropzone${dragging ? ' active' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <span className="import-drop-icon">📄</span>
          {fileName
            ? <><strong>{fileName}</strong><span className="muted small"> — файл загружен, можно редактировать</span></>
            : <><span>Перетащи <strong>.txt</strong> файл сюда</span><span className="muted small"> или нажми для выбора</span></>
          }
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
        </div>

        <p className="muted small" style={{ margin: '8px 0 4px' }}>
          Формат файла: текст сцены, затем строка <code>IMG: промт</code> — и так для каждой сцены.<br />
          Или: слева сценарий (абзацы через пустую строку), справа промты по одному на строку.
        </p>

        <div className="import-cols">
          <label>
            Сценарий
            <textarea
              rows={12}
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder={'Текст первой сцены…\nIMG: cinematic winter city\n\nТекст второй сцены…\nIMG: close-up of a face'}
            />
          </label>
          <label>
            Промты (необязательно)
            <textarea
              rows={12}
              value={promptsText}
              onChange={(e) => setPromptsText(e.target.value)}
              placeholder={'cinematic winter city\nclose-up of a face'}
            />
          </label>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Отмена</button>
          <button onClick={doImport} disabled={!scriptText.trim()}>
            Разобрать и вставить
          </button>
        </div>
      </div>
    </div>
  );
}
