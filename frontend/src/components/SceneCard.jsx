import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const STATUS = {
  none: { label: 'нет картинки', cls: 'none' },
  pending: { label: 'генерится…', cls: 'pending' },
  done: { label: 'готово', cls: 'done' },
  error: { label: 'ошибка', cls: 'error' },
};

// Одна сцена: превью картинки + статус + действия, плюс поля текста и промта.
export default function SceneCard({ projectId, scene, index, total, onMove, onDelete, onChanged }) {
  const [voiceText, setVoiceText] = useState(scene.voiceText);
  const [imagePrompt, setImagePrompt] = useState(scene.imagePrompt);
  const fileRef = useRef(null);

  // подхватываем правки промта/текста, если сцена обновилась извне (например импорт)
  useEffect(() => setVoiceText(scene.voiceText), [scene.voiceText]);
  useEffect(() => setImagePrompt(scene.imagePrompt), [scene.imagePrompt]);

  const st = STATUS[scene.imageStatus] ?? STATUS.none;
  const busy = scene.imageStatus === 'pending';
  const cacheBust = scene.imageUpdatedAt ? `?t=${new Date(scene.imageUpdatedAt).getTime()}` : '';

  const saveField = (field, value) => {
    if (value !== scene[field]) api.updateScene(projectId, scene.id, { [field]: value }).catch(() => {});
  };

  async function regen(newSeed) {
    await api.genSceneImage(projectId, scene.id, newSeed);
    onChanged?.(); // родитель начнёт поллинг статусов
  }

  function onPickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      await api.uploadSceneImage(projectId, scene.id, ev.target.result);
      onChanged?.();
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="scene-card">
      <div className="scene-card-num">
        <span>{index + 1}</span>
        <div className="scene-move">
          <button className="icon-btn" onClick={() => onMove(-1)} disabled={index === 0}>▲</button>
          <button className="icon-btn" onClick={() => onMove(1)} disabled={index === total - 1}>▼</button>
        </div>
      </div>

      {/* Превью картинки */}
      <div className="scene-image">
        <div className={`thumb thumb-${st.cls}`}>
          {scene.imagePath ? (
            <img src={`/files/${scene.imagePath}${cacheBust}`} alt={`сцена ${index + 1}`} />
          ) : (
            <span className="thumb-text">{busy ? '⏳' : '🖼'}</span>
          )}
          <span className={`thumb-badge badge-${st.cls}`}>{busy ? 'генерится…' : st.label}</span>
        </div>
        <div className="scene-image-actions">
          <button className="ghost small" onClick={() => regen(false)} disabled={busy}>
            {scene.imageStatus === 'done' ? '🔄 Перегенерировать' : '✨ Сгенерировать'}
          </button>
          <button className="ghost small" onClick={() => regen(true)} disabled={busy} title="Та же сцена, другой результат">
            🎲 Другой вариант
          </button>
          <button className="ghost small" onClick={() => fileRef.current?.click()} disabled={busy}>
            ⬆ Своё фото
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
        </div>
        {scene.imageStatus === 'error' && scene.imageError && (
          <div className="error-box small">{scene.imageError}</div>
        )}
      </div>

      {/* Текст и промт */}
      <div className="scene-card-fields">
        <label>
          Текст озвучки
          <textarea
            rows={3}
            value={voiceText}
            onChange={(e) => setVoiceText(e.target.value)}
            onBlur={() => saveField('voiceText', voiceText)}
            placeholder="Что будет звучать в этой сцене…"
          />
        </label>
        <label>
          Промт картинки
          <textarea
            rows={2}
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            onBlur={() => saveField('imagePrompt', imagePrompt)}
            placeholder="Image prompt (лучше на английском)…"
          />
        </label>
        <span className="muted small">
          После правки промта нажми «Перегенерировать» — картинка заменится на этом же месте.
        </span>
      </div>

      <button className="icon-btn danger" title="Удалить сцену" onClick={onDelete} disabled={total === 1}>✕</button>
    </div>
  );
}
