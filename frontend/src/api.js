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
  listProjects: () => req('GET', '/api/projects'),
  createProject: (title) => req('POST', '/api/projects', { title }),
  getProject: (id) => req('GET', `/api/projects/${id}`),
  updateProject: (id, patch) => req('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id) => req('DELETE', `/api/projects/${id}`),

  // Сцены (поштучно)
  addScene: (id, scene) => req('POST', `/api/projects/${id}/scenes`, scene ?? {}),
  updateScene: (id, sceneId, patch) => req('PATCH', `/api/projects/${id}/scenes/${sceneId}`, patch),
  deleteScene: (id, sceneId) => req('DELETE', `/api/projects/${id}/scenes/${sceneId}`),
  reorderScenes: (id, orderedIds) => req('POST', `/api/projects/${id}/scenes/reorder`, { orderedIds }),
  scenesStatus: (id) => req('GET', `/api/projects/${id}/scenes/status`),

  // Импорт целиком (заменяет все сцены)
  replaceScenes: (id, scenes) => req('PUT', `/api/projects/${id}/scenes`, { scenes }),
  parseScript: (id, scriptText, promptsText) =>
    req('POST', `/api/projects/${id}/parse`, { scriptText, promptsText }),

  // Картинки
  genSceneImage: (id, sceneId, newSeed = false) =>
    req('POST', `/api/projects/${id}/scenes/${sceneId}/image`, { newSeed }),
  genMissingImages: (id) => req('POST', `/api/projects/${id}/images/generate-missing`),
  uploadSceneImage: (id, sceneId, dataUri) =>
    req('POST', `/api/projects/${id}/scenes/${sceneId}/upload`, { dataUri }),
  setActiveImage: (id, sceneId, imageId) =>
    req('POST', `/api/projects/${id}/scenes/${sceneId}/active`, { imageId }),

  // Озвучка-превью
  voicePreview: (id) => req('POST', `/api/projects/${id}/voice-preview`),

  // Запуски (сборка)
  startJob: (projectId) => req('POST', `/api/projects/${projectId}/jobs`),
  getJob: (jobId) => req('GET', `/api/jobs/${jobId}`),

  // Справочники / статус
  providers: () => req('GET', '/api/meta/providers'),
  voicerBalance: () => req('GET', '/api/meta/voicer/balance'),
  voicerTemplates: () => req('GET', '/api/meta/voicer/templates'),
  usage: () => req('GET', '/api/meta/usage'),
  status: () => req('GET', '/api/meta/status'),
  effects: () => req('GET', '/api/meta/effects'),
};
