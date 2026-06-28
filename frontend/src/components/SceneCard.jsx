import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const STATUS = {
  none: { label: 'нет картинки', cls: 'none' },
  pending: { label: 'генерится…', cls: 'pending' },
  done: { label: 'готово', cls: 'done' },
  error: { label: 'ошибка', cls: 'error' },
};

// Одна сцена: превью картинки + статус + действия, плюс поля текста и промта.
export default function SceneCard({ projectId, scene, index, total, onMove, onDelete, onChanged, onRefresh, effects }) {
  const [voiceText, setVoiceText] = useState(scene.voiceText);
  const [imagePrompt, setImagePrompt] = useState(scene.imagePrompt);
  const fileRef = useRef(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

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
      onRefresh?.();
    };
    reader.readAsDataURL(file);
  }

  async function pickVariant(imageId) {
    await api.setActiveImage(projectId, scene.id, imageId);
    onRefresh?.();
  }

  const variants = scene.images ?? [];

  return (
    <div className="scene-card" ref={setNodeRef} style={style}>
      <div className="scene-card-num">
        <span className="drag-handle" {...attributes} {...listeners} title="Перетащить">⠿</span>
        <span className="scene-num-badge">#{index + 1}</span>
        <div className="scene-move">
          <button className="icon-btn" onClick={() => onMove(-1)} disabled={index === 0} title="Выше"><Icon name="chevronUp" size={12} /></button>
          <button className="icon-btn" onClick={() => onMove(1)} disabled={index === total - 1} title="Ниже"><Icon name="chevronDown" size={12} /></button>
        </div>
      </div>

      {/* Превью картинки */}
      <div className="scene-image">
        <div className={`thumb thumb-${st.cls}`}>
          {scene.imagePath ? (
            <img src={`/files/${scene.imagePath}${cacheBust}`} alt={`сцена ${index + 1}`} />
          ) : (
            <span className="thumb-text"><Icon name="image" size={28} stroke={1.2} /></span>
          )}
          <span className={`thumb-badge badge-${st.cls}`}>{busy ? 'генерится' : st.label}</span>
        </div>
        <div className="scene-image-actions">
          <button onClick={() => regen(false)} disabled={busy} title={scene.imageStatus === 'done' ? 'Сгенерировать заново с тем же промтом' : 'Сгенерировать'}>
            <Icon name={scene.imageStatus === 'done' ? 'refresh' : 'sparkles'} size={12} />
            {scene.imageStatus === 'done' ? 'Перегенерировать' : 'Сгенерировать'}
          </button>
          <button onClick={() => regen(true)} disabled={busy} title="Та же сцена, другой результат">
            <Icon name="dice" size={12} />
            Другой
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy} title="Загрузить своё фото">
            <Icon name="upload" size={12} />
            Своё
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
        </div>
        {scene.imageStatus === 'error' && scene.imageError && (
          <div className="error-box small">{scene.imageError}</div>
        )}

        {/* Лента вариантов */}
        {variants.length > 1 && (
          <div className="variants" title="Прошлые варианты — кликни, чтобы вернуть">
            {variants.map((v) => (
              <button
                key={v.id}
                className={`variant${v.id === scene.activeImageId ? ' active' : ''}`}
                onClick={() => pickVariant(v.id)}
                title={v.source === 'upload' ? 'Загруженное фото' : 'Сгенерировано'}
              >
                <img src={`/files/${v.path}`} alt="вариант" />
                {v.source === 'upload' && <span className="variant-tag">↑</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Текст и промт */}
      <div className="scene-card-fields">
        <label>
          Текст озвучки
          <textarea
            rows={2}
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
      </div>

      <div className="scene-card-side">
        <button className="icon-btn danger" title="Удалить сцену" onClick={onDelete} disabled={total === 1}>
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}
