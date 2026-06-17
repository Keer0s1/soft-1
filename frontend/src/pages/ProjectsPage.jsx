import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const STATUS = {
  queued: { label: 'в очереди', cls: 'status-queued' },
  running: { label: 'собирается', cls: 'status-running' },
  done: { label: 'готово', cls: 'status-done' },
  error: { label: 'ошибка', cls: 'status-error' },
};

function SortableProjectCard({ project, index, onNavigate, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    animationDelay: `${index * 60}ms`,
  };
  const last = project.jobs?.[0];
  const st = last ? STATUS[last.status] : null;
  const scene = project.scenes?.[0];
  const bg = scene?.imagePath ? `/files/${scene.imagePath}` : null;

  return (
    <div
      ref={setNodeRef}
      className="project-card"
      style={style}
      onClick={() => onNavigate(project.id)}
    >
      <div className="project-card-bg" style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
        {!bg && <div className="project-card-gradient" />}
      </div>
      <div className="project-card-overlay" />
      <div className="project-card-content">
        <div className="project-card-top">
          {st && <span className={`status-dot ${st.cls}`}>{st.label}</span>}
          <div className="project-card-top-actions">
            <span className="project-card-drag" {...attributes} {...listeners} title="Перетащить" onClick={(e) => e.stopPropagation()}>⠿</span>
            <button className="project-card-del" title="В корзину" onClick={(e) => onRemove(project.id, e)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/></svg>
            </button>
          </div>
        </div>
        <div className="project-card-bottom">
          <h3 className="project-card-title">{project.title}</h3>
          <span className="project-card-meta">
            {project._count?.scenes ?? 0} сцен · {project._count?.jobs ?? 0} сборок
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [archived, setArchived] = useState([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [permanentTarget, setPermanentTarget] = useState(null);
  const navigate = useNavigate();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  async function load() {
    setLoading(true);
    try {
      const list = await api.listProjects();
      setProjects(sortByUserOrder(list));
    } finally {
      setLoading(false);
    }
  }
  async function loadArchived() {
    setArchived(await api.listProjects(true));
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (showTrash) loadArchived(); }, [showTrash]);

  async function create(e) {
    e.preventDefault();
    const p = await api.createProject(title || 'Новый ролик');
    navigate(`/projects/${p.id}`);
  }

  async function remove(id, e) {
    e.stopPropagation();
    setDeleteTarget(id);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await api.deleteProject(deleteTarget);
    setDeleteTarget(null);
    load();
  }

  async function restore(id) {
    await api.restoreProject(id);
    loadArchived();
    load();
  }

  async function confirmPermanent() {
    if (!permanentTarget) return;
    await api.deleteProject(permanentTarget, true);
    setPermanentTarget(null);
    loadArchived();
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projects.findIndex((p) => p.id === active.id);
    const newIndex = projects.findIndex((p) => p.id === over.id);
    const reordered = arrayMove(projects, oldIndex, newIndex);
    setProjects(reordered);
    localStorage.setItem('projectOrder', JSON.stringify(reordered.map((p) => p.id)));
  }

  function sortByUserOrder(list) {
    const saved = localStorage.getItem('projectOrder');
    if (!saved) return list;
    try {
      const order = JSON.parse(saved);
      const map = new Map(list.map((p) => [p.id, p]));
      const sorted = order.filter((id) => map.has(id)).map((id) => map.get(id));
      const rest = list.filter((p) => !order.includes(p.id));
      return [...sorted, ...rest];
    } catch { return list; }
  }

  // ─── Корзина ───
  if (showTrash) {
    return (
      <div className="home">
        <section className="hero">
          <button className="trash-back" onClick={() => setShowTrash(false)}>← Назад к проектам</button>
          <h1 className="hero-title" style={{ fontSize: 34 }}>Корзина</h1>
          <p className="hero-sub">Удалённые проекты. Восстанови или сотри навсегда.</p>
        </section>

        {archived.length === 0 ? (
          <div className="empty-state">
            <div className="empty-glow" />
            <p className="empty-title">Корзина пуста</p>
            <p className="empty-sub">Удалённые проекты появятся здесь</p>
          </div>
        ) : (
          <div className="trash-grid">
            {archived.map((p, i) => {
              const bg = p.scenes?.[0]?.imagePath ? `/files/${p.scenes[0].imagePath}` : null;
              return (
                <div key={p.id} className="trash-card" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="trash-card-bg" style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
                    {!bg && <div className="project-card-gradient" />}
                  </div>
                  <div className="trash-card-overlay" />
                  <div className="trash-card-content">
                    <h3 className="trash-card-title">{p.title}</h3>
                    <span className="trash-card-meta">{p._count?.scenes ?? 0} сцен · {p._count?.jobs ?? 0} сборок</span>
                    <div className="trash-card-actions">
                      <button className="trash-btn-restore" onClick={() => restore(p.id)}>Восстановить</button>
                      <button className="trash-btn-delete" onClick={() => setPermanentTarget(p.id)}>Удалить навсегда</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {permanentTarget && (
          <ConfirmDialog
            title="Удалить навсегда?"
            message="Все файлы проекта будут безвозвратно удалены с вашего компьютера: картинки, видео, озвучка. Это действие НЕЛЬЗЯ отменить. Вы уверены?"
            confirmLabel="Да, удалить с компьютера"
            danger
            onConfirm={confirmPermanent}
            onCancel={() => setPermanentTarget(null)}
          />
        )}
      </div>
    );
  }

  // ─── Основная страница ───
  return (
    <div className="home">
      <section className="hero">
        <h1 className="hero-title">Твои ролики</h1>
        <p className="hero-sub">Создавай faceless-видео для YouTube в пару кликов</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28, alignItems: 'center' }}>
          <button className="hero-btn" onClick={() => setShowCreate(true)}>
            + Новый ролик
          </button>
        </div>
        <button className="trash-link" onClick={() => setShowTrash(true)}>
          Корзина{archived.length > 0 ? ` (${archived.length})` : ''}
        </button>
      </section>

      {showCreate && (
        <form className="create-form" onSubmit={create}>
          <input
            autoFocus
            placeholder="Название ролика…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="primary">Создать</button>
          <button type="button" className="ghost" onClick={() => setShowCreate(false)}>Отмена</button>
        </form>
      )}

      {loading ? (
        <div className="home-loading"><div className="loader" /></div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-glow" />
          <p className="empty-title">Пока пусто</p>
          <p className="empty-sub">Создай первый ролик — это займёт минуту</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={projects.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="projects-grid">
              {projects.map((p, i) => (
                <SortableProjectCard
                  key={p.id}
                  project={p}
                  index={i}
                  onNavigate={(id) => navigate(`/projects/${id}`)}
                  onRemove={remove}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="В корзину?"
          message="Проект переместится в корзину. Файлы на диске останутся. Восстановить можно в любой момент."
          confirmLabel="В корзину"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
