import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const STATUS_LABEL = {
  queued: '⏳ в очереди',
  running: '⚙️ собирается',
  done: '✅ готово',
  error: '❌ ошибка',
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    const p = await api.createProject(title || 'Новый ролик');
    navigate(`/projects/${p.id}`);
  }

  async function remove(id, e) {
    e.stopPropagation();
    if (!confirm('Удалить проект и всю его историю?')) return;
    await api.deleteProject(id);
    load();
  }

  return (
    <div>
      <h1>Мои ролики</h1>

      <form className="new-project" onSubmit={create}>
        <input
          placeholder="Название нового ролика…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit">+ Создать</button>
      </form>

      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : projects.length === 0 ? (
        <p className="muted">Пока нет проектов. Создай первый выше ☝️</p>
      ) : (
        <div className="cards">
          {projects.map((p) => {
            const last = p.jobs?.[0];
            return (
              <div key={p.id} className="card" onClick={() => navigate(`/projects/${p.id}`)}>
                <div className="card-head">
                  <h3>{p.title}</h3>
                  <button className="icon-btn" title="Удалить" onClick={(e) => remove(p.id, e)}>
                    🗑
                  </button>
                </div>
                <div className="card-meta">
                  <span>{p._count?.scenes ?? 0} сцен</span>
                  <span>·</span>
                  <span>{p._count?.jobs ?? 0} запусков</span>
                </div>
                {last && (
                  <div className="card-status">{STATUS_LABEL[last.status] ?? last.status}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
