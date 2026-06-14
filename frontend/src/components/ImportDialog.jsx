import { useState } from 'react';
import { api } from '../api.js';

// Импорт сцен из вставленного текста.
// Способ 1: один сценарий с маркерами "IMG: промт" после каждого куска.
// Способ 2: сценарий (абзацы через пустую строку) + отдельный список промтов.
export default function ImportDialog({ projectId, onImported, onClose }) {
  const [scriptText, setScriptText] = useState('');
  const [promptsText, setPromptsText] = useState('');
  const [error, setError] = useState('');

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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Импорт сценария</h3>
        <p className="muted small">
          Способ 1: вставь сценарий, после каждого куска текста — строка{' '}
          <code>IMG: промт картинки</code>.<br />
          Способ 2: слева сценарий (абзацы через пустую строку), справа промты — по одному на строку.
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
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button onClick={doImport}>Разобрать и вставить</button>
        </div>
      </div>
    </div>
  );
}
