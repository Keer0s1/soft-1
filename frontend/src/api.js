// Тонкая обёртка над fetch к нашему бэкенду.

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

export const api = {
  // Проекты
  listProjects: (archived) => req('GET', `/api/projects${archived ? '?archived=true' : ''}`),
  createProject: (title) => req('POST', '/api/projects', { title }),
  getProject: (id) => req('GET', `/api/projects/${id}`),
  updateProject: (id, patch) => req('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id, permanent = false) => req('DELETE', `/api/projects/${id}${permanent ? '?permanent=true' : ''}`),

  // Восстановить архивный проект
  restoreProject: (id) => req('POST', `/api/projects/${id}/restore`),

  // Сцены (поштучно)
  addScene: (id, scene) => req('POST', `/api/projects/${id}/scenes`, scene ?? {}),
  updateScene: (id, sceneId, patch) => req('PATCH', `/api/projects/${id}/scenes/${sceneId}`, patch),
  deleteScene: (id, sceneId) => req('DELETE', `/api/projects/${id}/scenes/${sceneId}`),
  reorderScenes: (id, orderedIds) => req('POST', `/api/projects/${id}/scenes/reorder`, { orderedIds }),
  scenesStatus: (id) => req('GET', `/api/projects/${id}/scenes/status`),
  batchUpdateScenes: (id, sceneIds, patch) => req('POST', `/api/projects/${id}/scenes/batch-update`, { sceneIds, patch }),

  // Импорт целиком (заменяет все сцены)
  replaceScenes: (id, scenes) => req('PUT', `/api/projects/${id}/scenes`, { scenes }),
  replaceScenesWithImages: (id, scenes) => req('POST', `/api/projects/${id}/scenes/with-images`, { scenes }),
  parseFiles: (id, speechText, promptsText, opts = {}) =>
    req('POST', `/api/projects/${id}/parse`, { speechText, promptsText, ...opts }),

  // Картинки
  genSceneImage: (id, sceneId, newSeed = false) =>
    req('POST', `/api/projects/${id}/scenes/${sceneId}/image`, { newSeed }),
  genMissingImages: (id) => req('POST', `/api/projects/${id}/images/generate-missing`),
  cancelImages: (id) => req('DELETE', `/api/projects/${id}/images/cancel`),
  uploadSceneImage: (id, sceneId, dataUri) =>
    req('POST', `/api/projects/${id}/scenes/${sceneId}/upload`, { dataUri }),
  setActiveImage: (id, sceneId, imageId) =>
    req('POST', `/api/projects/${id}/scenes/${sceneId}/active`, { imageId }),

  // Озвучка-превью
  voicePreview: (id) => req('POST', `/api/projects/${id}/voice-preview`),
  voiceTimestamps: (id) => req('GET', `/api/projects/${id}/voice-timestamps`),
  voiceSilences: (id) => req('GET', `/api/projects/${id}/voice-silences`),
  uploadVoice: (id, dataUri) => req('POST', `/api/projects/${id}/voice-upload`, { dataUri }),
  removeCustomVoice: (id) => req('DELETE', `/api/projects/${id}/voice-custom`),

  // Видео-превью (ffmpeg, авто)
  videoPreview: (id) => req('POST', `/api/projects/${id}/video-preview`),

  // SFX
  sfxLibrary: () => req('GET', '/api/sfx/library'),
  sfxCustom: (id) => req('GET', `/api/projects/${id}/sfx/custom`),
  sfxUpload: (id, dataUri, name) => req('POST', `/api/projects/${id}/sfx/upload`, { dataUri, name }),
  sfxPlacements: (id) => req('GET', `/api/projects/${id}/sfx/placements`),
  sfxPlace: (id, data) => req('POST', `/api/projects/${id}/sfx/placements`, data),
  sfxMove: (id, pid, data) => req('PATCH', `/api/projects/${id}/sfx/placements/${pid}`, data),
  sfxRemove: (id, pid) => req('DELETE', `/api/projects/${id}/sfx/placements/${pid}`),

  // CTA overlays
  ctaList: (id) => req('GET', `/api/projects/${id}/cta`),
  ctaCreate: (id, data) => req('POST', `/api/projects/${id}/cta`, data),
  ctaUpdate: (id, cid, data) => req('PATCH', `/api/projects/${id}/cta/${cid}`, data),
  ctaRemove: (id, cid) => req('DELETE', `/api/projects/${id}/cta/${cid}`),
  ctaUploadImage: (id, dataUri, name) => req('POST', `/api/projects/${id}/cta/upload-image`, { dataUri, name }),

  // Overlays
  overlaysList: (id) => req('GET', `/api/projects/${id}/overlays`),
  overlayCreate: (id, data) => req('POST', `/api/projects/${id}/overlays`, data),
  overlayUpdate: (id, oid, data) => req('PATCH', `/api/projects/${id}/overlays/${oid}`, data),
  overlayRemove: (id, oid) => req('DELETE', `/api/projects/${id}/overlays/${oid}`),
  overlayUpload: (id, dataUri, name) => req('POST', `/api/projects/${id}/overlays/upload`, { dataUri, name }),
  overlaySounds: () => req('GET', '/api/overlays/sounds'),

  // Музыка
  uploadMusic: (id, dataUri) => req('POST', `/api/projects/${id}/music`, { dataUri }),

  // Запуски (сборка)
  startJob: (projectId, opts) => req('POST', `/api/projects/${projectId}/jobs`, opts),
  getJob: (jobId) => req('GET', `/api/jobs/${jobId}`),

  // Справочники / статус
  providers: () => req('GET', '/api/meta/providers'),
  voicerBalance: () => req('GET', '/api/meta/voicer/balance'),
  voicerTemplates: () => req('GET', '/api/meta/voicer/templates'),
  usage: () => req('GET', '/api/meta/usage'),
  status: () => req('GET', '/api/meta/status'),
  effects: () => req('GET', '/api/meta/effects'),
  luts: () => req('GET', '/api/meta/luts'),
  musicList: () => req('GET', '/api/meta/music'),

  // Прокси
  proxyGet: () => req('GET', '/api/meta/proxy'),
  proxySave: (data) => req('PUT', '/api/meta/proxy', data),
  proxyTest: (data) => req('POST', '/api/meta/proxy/test', data || {}),
  proxyTestImage: (data) => req('POST', '/api/meta/proxy/test-image', data || {}),
};
