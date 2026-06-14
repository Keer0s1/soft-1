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
  saveScenes: (id, scenes) => req('PUT', `/api/projects/${id}/scenes`, { scenes }),
  parseScript: (id, scriptText, promptsText) =>
    req('POST', `/api/projects/${id}/parse`, { scriptText, promptsText }),

  // Запуски
  startJob: (projectId) => req('POST', `/api/projects/${projectId}/jobs`),
  getJob: (jobId) => req('GET', `/api/jobs/${jobId}`),

  // Справочники
  providers: () => req('GET', '/api/meta/providers'),
  voicerBalance: () => req('GET', '/api/meta/voicer/balance'),
  voicerTemplates: () => req('GET', '/api/meta/voicer/templates'),
};
