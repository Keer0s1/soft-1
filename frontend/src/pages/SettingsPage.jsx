import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const PROTOCOLS = [
  { id: 'http',   label: 'HTTP' },
  { id: 'https',  label: 'HTTPS' },
  { id: 'socks5', label: 'SOCKS5' },
];

// Парсер строки прокси из буфера обмена.
// Поддерживаем:
//   host:port
//   host:port:user:pass
//   user:pass@host:port
//   protocol://user:pass@host:port
//   protocol://host:port
function parseProxyString(raw) {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  // protocol://...
  let protocol = null;
  const protoMatch = /^(socks5|http|https):\/\//i.exec(s);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    s = s.slice(protoMatch[0].length);
  }
  // user:pass@host:port (URL-style)
  if (s.includes('@')) {
    const atIdx = s.lastIndexOf('@');
    const auth = s.slice(0, atIdx);
    const hp = s.slice(atIdx + 1);
    const [user, ...passParts] = auth.split(':');
    const [host, port] = hp.split(':');
    if (host && port) {
      return {
        protocol: protocol ?? 'http',
        host: host.trim(),
        port: Number(port),
        username: decodeURIComponent(user || ''),
        password: decodeURIComponent(passParts.join(':') || ''),
      };
    }
  }
  // host:port:user:pass (как в большинстве прокси-сервисов)
  const parts = s.split(':').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    return { protocol: protocol ?? 'http', host: parts[0], port: Number(parts[1]), username: '', password: '' };
  }
  if (parts.length >= 4) {
    return {
      protocol: protocol ?? 'http',
      host: parts[0],
      port: Number(parts[1]),
      username: parts[2],
      password: parts.slice(3).join(':'),
    };
  }
  return null;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [imageResult, setImageResult] = useState(null);
  const [savedHasPassword, setSavedHasPassword] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [form, setForm] = useState({
    enabled: false,
    protocol: 'http',
    host: '',
    port: 8080,
    username: '',
    password: '',
  });

  // Параметры для «Проверить картинкой»
  const [providers, setProviders] = useState([]);
  const [imgProvider, setImgProvider] = useState('flow');
  const [imgPrompt, setImgPrompt] = useState('cute fluffy kitten sitting on a windowsill, soft light');

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.proxyGet();
        setForm({
          enabled: !!cfg.enabled,
          protocol: cfg.protocol || 'http',
          host: cfg.host || '',
          port: cfg.port || 8080,
          username: cfg.username || '',
          password: '',
        });
        setSavedHasPassword(!!cfg.hasPassword);
      } catch (e) {
        setError(`Не удалось загрузить настройки: ${e.message}`);
      } finally {
        setLoading(false);
      }
      // Подтянем список провайдеров для теста
      try {
        const r = await api.providers();
        const list = Array.isArray(r?.providers) ? r.providers : [];
        setProviders(list);
        if (list.length && !list.find((p) => p.id === 'flow')) {
          setImgProvider(list[0].id);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
    setOkMsg('');
    setError('');
    setTestResult(null);
    setImageResult(null);
  }

  function applyPaste() {
    setPasteError('');
    const parsed = parseProxyString(pasteValue);
    if (!parsed) {
      setPasteError('Не понял формат. Попробуй host:port:user:pass или http://user:pass@host:port');
      return;
    }
    if (!parsed.host || !parsed.port || parsed.port < 1 || parsed.port > 65535) {
      setPasteError('Неверный host или порт');
      return;
    }
    update({
      enabled: true,
      protocol: parsed.protocol,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
    });
    setPasteValue('');
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
      setOkMsg(
        cfg.enabled
          ? `Сохранено и включено: ${cfg.protocol}://${cfg.host}:${cfg.port}. Все исходящие пойдут через прокси.`
          : 'Сохранено. Прокси выключен — запросы идут напрямую.',
      );
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
    setImageResult(null);
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

  // Если пароль в форме не введён, а на бэке уже сохранён — тестируем
  // СОХРАНЁННУЮ конфигурацию (пустой body = использовать current).
  // Иначе бэк подставит пустой пароль и прокси ответит 407.
  function currentPayload() {
    if (!form.host) return {};
    if (savedHasPassword && !form.password) return {};
    return {
      protocol: form.protocol,
      host: form.host,
      port: Number(form.port),
      username: form.username,
      password: form.password,
    };
  }

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    setImageResult(null);
    setOkMsg('');
    setError('');
    try {
      const r = await api.proxyTest(currentPayload());
      setTestResult(r);
    } catch (e) {
      setError(`Тест не удался: ${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  async function onTestImage() {
    setTestingImage(true);
    setImageResult(null);
    setTestResult(null);
    setOkMsg('');
    setError('');
    try {
      // test-image использует ТОЛЬКО сохранённую конфигурацию прокси —
      // нужно сначала нажать «Сохранить», чтобы тест шёл через нужный прокси.
      const r = await api.proxyTestImage({
        provider: imgProvider,
        prompt: imgPrompt,
      });
      setImageResult(r);
    } catch (e) {
      setError(`Проверка картинкой не удалась: ${e.message}`);
    } finally {
      setTestingImage(false);
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
          Если фотки не подгружаются — провайдер режет CDN fast-gen. Включи
          прокси, и весь трафик к Voicer / fast-gen, включая скачивание
          картинок, пойдёт через него.
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

        <div className="settings-row" style={{ marginBottom: 18 }}>
          <span className="settings-label">
            Быстро вставить
            <span className="settings-hint"> · host:port:user:pass или http://user:pass@host:port</span>
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="161.115.230.182:9494:user:pass"
              value={pasteValue}
              onChange={(e) => { setPasteValue(e.target.value); setPasteError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPaste(); } }}
              style={{ flex: 1 }}
            />
            <button type="button" className="ghost" onClick={applyPaste} disabled={!pasteValue.trim()}>
              Разобрать
            </button>
          </div>
          {pasteError && <span className="settings-hint" style={{ color: 'var(--red)' }}>{pasteError}</span>}
        </div>

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
            {testing ? 'Пингую…' : 'Пинг API'}
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>

        {error && <div className="settings-msg settings-msg-error">{error}</div>}
        {okMsg && <div className="settings-msg settings-msg-ok">{okMsg}</div>}

        {testResult && (
          <div className="settings-test">
            <div className="settings-test-title">Пинг API</div>
            <TestRow label="Voicer"   result={testResult.voicer}  />
            <TestRow label="fast-gen" result={testResult.fastgen} />
          </div>
        )}

      </form>

      <div className="settings-card" style={{ marginTop: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Проверка картинкой</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>
          Реально сгенерит картинку через fast-gen и скачает её со storage —
          это единственный способ убедиться, что прокси тянет CDN. fast-gen
          спишет кредиты по своему тарифу (обычно 4 за картинку).
          <br />
          <b>Важно:</b> сначала нажми «Сохранить» в форме прокси — проверка
          использует именно сохранённую конфигурацию.
        </p>

        <div className="settings-grid">
          <label className="settings-row">
            <span className="settings-label">Провайдер</span>
            <select value={imgProvider} onChange={(e) => setImgProvider(e.target.value)}>
              {providers.length === 0 && <option value="flow">Flow</option>}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="settings-row" style={{ gridColumn: 'span 2' }}>
            <span className="settings-label">Промпт</span>
            <input
              type="text"
              value={imgPrompt}
              onChange={(e) => setImgPrompt(e.target.value)}
            />
          </label>
        </div>

        <div className="settings-actions">
          <button
            type="button"
            className="primary"
            onClick={onTestImage}
            disabled={testingImage || !imgPrompt.trim()}
          >
            {testingImage ? 'Генерирую…' : 'Сгенерировать тестовую'}
          </button>
        </div>

        {imageResult && (
          <div className="settings-test">
            <div className="settings-test-title">
              Результат · {imageResult.via === 'proxy' ? 'через прокси' : 'напрямую'} · {imageResult.provider}
            </div>
            <div className={`settings-test-row ${imageResult.ok ? 'is-ok' : 'is-err'}`}>
              <span className="settings-test-dot" />
              <span className="settings-test-label">Статус</span>
              <span className="settings-test-meta">
                {imageResult.ok
                  ? `OK · ${Math.round(imageResult.totalMs / 100) / 10}c · ${Math.round(imageResult.imageBytes / 1024)} КБ`
                  : imageResult.error}
              </span>
            </div>
            {imageResult.ok && (
              <>
                <div className="settings-test-row is-ok">
                  <span className="settings-test-dot" style={{ visibility: 'hidden' }} />
                  <span className="settings-test-label">Тайминги</span>
                  <span className="settings-test-meta">
                    submit {imageResult.submitMs} мс · download {imageResult.downloadMs} мс
                  </span>
                </div>
                {imageResult.imageDataUri && (
                  <div style={{ marginTop: 14, textAlign: 'center' }}>
                    <img
                      src={imageResult.imageDataUri}
                      alt="test result"
                      style={{ maxWidth: 320, maxHeight: 320, borderRadius: 8, border: '1px solid var(--rw-hairline)' }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
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
