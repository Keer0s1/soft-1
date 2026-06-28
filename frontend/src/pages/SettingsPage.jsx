import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const PROTOCOLS = [
  { id: 'socks5', label: 'SOCKS5' },
  { id: 'http',   label: 'HTTP' },
  { id: 'https',  label: 'HTTPS' },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [savedHasPassword, setSavedHasPassword] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [form, setForm] = useState({
    enabled: false,
    protocol: 'socks5',
    host: '',
    port: 1080,
    username: '',
    password: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.proxyGet();
        setForm({
          enabled: !!cfg.enabled,
          protocol: cfg.protocol || 'socks5',
          host: cfg.host || '',
          port: cfg.port || 1080,
          username: cfg.username || '',
          password: '',
        });
        setSavedHasPassword(!!cfg.hasPassword);
      } catch (e) {
        setError(`Не удалось загрузить настройки: ${e.message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
    setOkMsg('');
    setError('');
    setTestResult(null);
  }

  async function onSave(e) {
    e?.preventDefault();
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const cfg = await api.proxySave({
        enabled: form.enabled,
        protocol: form.protocol,
        host: form.host,
        port: Number(form.port),
        username: form.username,
        password: form.password,
      });
      setSavedHasPassword(!!cfg.hasPassword);
      setForm((f) => ({ ...f, password: '' }));
      setOkMsg('Сохранено. Новые настройки уже применились.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function onDisable() {
    setSaving(true);
    setError('');
    setOkMsg('');
    setTestResult(null);
    try {
      const cfg = await api.proxySave({ enabled: false });
      setForm((f) => ({ ...f, enabled: false }));
      setSavedHasPassword(!!cfg.hasPassword);
      setOkMsg('Прокси отключён. Все запросы идут напрямую.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    setOkMsg('');
    setError('');
    try {
      const payload = form.host
        ? {
            protocol: form.protocol,
            host: form.host,
            port: Number(form.port),
            username: form.username,
            password: form.password,
          }
        : {};
      const r = await api.proxyTest(payload);
      setTestResult(r);
    } catch (e) {
      setError(`Тест не удался: ${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-page">
        <div className="home-loading"><div className="loader" /></div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-head">
        <Link to="/" className="settings-back">← К проектам</Link>
        <h1 style={{ margin: '12px 0 4px' }}>Настройки</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Если хост Voicer / fast-gen не открывается напрямую (например, заблочена
          раздача файлов в твоём регионе) — подключи прокси. Все запросы к этим
          двум сервисам и скачивание готовых картинок пойдут через него.
        </p>
      </div>

      <form className="settings-card" onSubmit={onSave}>
        <h2 style={{ margin: '0 0 14px', fontSize: 18 }}>Прокси</h2>

        <label className="settings-row settings-switch">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span>Использовать прокси для всех исходящих запросов</span>
        </label>

        <div className="settings-grid">
          <label className="settings-row">
            <span className="settings-label">Протокол</span>
            <select
              value={form.protocol}
              onChange={(e) => update({ protocol: e.target.value })}
            >
              {PROTOCOLS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>

          <label className="settings-row" style={{ gridColumn: 'span 2' }}>
            <span className="settings-label">Host</span>
            <input
              type="text"
              placeholder="proxy.example.com или 1.2.3.4"
              value={form.host}
              onChange={(e) => update({ host: e.target.value })}
            />
          </label>

          <label className="settings-row">
            <span className="settings-label">Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(e) => update({ port: e.target.value })}
            />
          </label>

          <label className="settings-row">
            <span className="settings-label">Логин (опционально)</span>
            <input
              type="text"
              value={form.username}
              onChange={(e) => update({ username: e.target.value })}
            />
          </label>

          <label className="settings-row">
            <span className="settings-label">
              Пароль (опционально)
              {savedHasPassword && !form.password && (
                <span className="settings-hint"> · сохранён, оставь пустым чтобы не менять</span>
              )}
            </span>
            <input
              type="password"
              value={form.password}
              onChange={(e) => update({ password: e.target.value })}
              placeholder={savedHasPassword ? '••••••••' : ''}
            />
          </label>
        </div>

        <div className="settings-actions">
          <button type="button" className="ghost" onClick={onDisable} disabled={saving || !form.enabled}>
            Отключить
          </button>
          <button type="button" className="ghost" onClick={onTest} disabled={testing || !form.host}>
            {testing ? 'Проверяю…' : 'Проверить'}
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>

        {error && <div className="settings-msg settings-msg-error">{error}</div>}
        {okMsg && <div className="settings-msg settings-msg-ok">{okMsg}</div>}

        {testResult && (
          <div className="settings-test">
            <div className="settings-test-title">Тест соединения</div>
            <TestRow label="Voicer"   result={testResult.voicer}  />
            <TestRow label="fast-gen" result={testResult.fastgen} />
          </div>
        )}
      </form>
    </div>
  );
}

function TestRow({ label, result }) {
  const ok = result?.ok;
  return (
    <div className={`settings-test-row ${ok ? 'is-ok' : 'is-err'}`}>
      <span className="settings-test-dot" />
      <span className="settings-test-label">{label}</span>
      <span className="settings-test-meta">
        {ok ? `${result.status ?? 'OK'} · ${result.latencyMs} мс` : (result?.error || 'нет связи')}
      </span>
    </div>
  );
}
