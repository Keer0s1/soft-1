import { useEffect, useState } from 'react';
import { api } from '../api.js';

const IconImage = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);

const IconTokens = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 7 4 4 20 4 20 7"/>
    <line x1="9" y1="20" x2="15" y2="20"/>
    <line x1="12" y1="4" x2="12" y2="20"/>
  </svg>
);

const IconMic = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

const IconDays = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const DOT_COLOR = { green: '#3ecf8e', yellow: '#f5c451', red: '#ff6b6b' };
const DOT_LABEL = { green: 'работает', yellow: 'тормозит', red: 'недоступен' };

// 794248 → "794k", 1500000 → "1.5M"
function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// Вытащить "13h 14min" из balance_description.en → "13h 14m"
function parseDuration(desc) {
  if (!desc) return null;
  const m = /(\d+)h\s*(\d+)min/i.exec(desc);
  if (m) return `${m[1]}h ${m[2]}m`;
  const h = /(\d+)h/i.exec(desc);
  if (h) return `${h[1]}h`;
  const min = /(\d+)min/i.exec(desc);
  if (min) return `${min[1]}m`;
  return null;
}

export default function StatusBar() {
  const [status, setStatus] = useState(null);
  const [usage, setUsage] = useState(null);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    const pull = () => {
      api.status().then(setStatus).catch(() => setStatus(null));
      api.usage().then(setUsage).catch(() => setUsage(null));
      api.voicerBalance().then(setBalance).catch(() => setBalance(null));
    };
    pull();
    const s = setInterval(() => api.status().then(setStatus).catch(() => {}), 20_000);
    const u = setInterval(() => {
      api.usage().then(setUsage).catch(() => {});
      api.voicerBalance().then(setBalance).catch(() => {});
    }, 60_000);
    return () => { clearInterval(s); clearInterval(u); };
  }, []);

  const fgHealth = status?.fastgen?.health ?? null;
  const voHealth = status?.voicer?.health ?? null;

  // fast-gen: лимит картинок/час и токенов/час
  const credits = usage?.credits ?? usage?.images?.limit ?? null;
  const tokens  = usage?.tokens ?? usage?.promptTokensLimit ?? null;
  const days    = usage?.daysLeft ?? null;

  // Voicer: символы и длительность
  const voChars    = balance?.balance ?? null;
  const voDuration = parseDuration(balance?.balance_description?.en);

  return (
    <div className="sb-pill">

      {/* ── fast-gen статус + данные ── */}
      {fgHealth && (
        <span
          className="sb-dot-wrap"
          title={`fast-gen · ${status.fastgen.latencyMs} мс · ${DOT_LABEL[fgHealth]}`}
        >
          <span className="sb-dot" style={{ background: DOT_COLOR[fgHealth] }} />
          <span className="sb-dot-label">fast-gen</span>
        </span>
      )}

      {fgHealth && <span className="sb-sep" />}

      {/* Лимит картинок в час */}
      <span className="sb-item" title="Лимит генераций картинок в час">
        <IconImage />
        <span>{credits != null ? fmt(credits) : '—'}</span>
      </span>

      {/* Лимит токенов промтов в час */}
      <span className="sb-sep" />
      <span className="sb-item" title="Лимит токенов промтов в час (fast-gen)">
        <IconTokens />
        <span>{tokens != null ? fmt(tokens) : '—'}</span>
      </span>

      {/* Дни подписки fast-gen */}
      {days != null && (
        <>
          <span className="sb-sep" />
          <span className="sb-item" title="Дней до конца подписки fast-gen">
            <IconDays />
            <span>{days}d</span>
          </span>
        </>
      )}

      {/* ── разделитель между fast-gen и Voicer ── */}
      <span className="sb-block-sep" />

      {/* ── Voicer статус + данные ── */}
      {voHealth && (
        <span
          className="sb-dot-wrap"
          title={`Voicer · ${status.voicer.latencyMs} мс · ${DOT_LABEL[voHealth]}`}
        >
          <span className="sb-dot" style={{ background: DOT_COLOR[voHealth] }} />
          <span className="sb-dot-label">Voicer</span>
        </span>
      )}

      {voHealth && <span className="sb-sep" />}

      {/* Символы баланса Voicer */}
      <span
        className="sb-item"
        title={`Баланс Voicer · ${balance?.balance_description?.en ?? ''}`}
      >
        <IconMic />
        <span>{voChars != null ? fmt(voChars) : '—'}</span>
        {voDuration && <span className="sb-sub">({voDuration})</span>}
      </span>

    </div>
  );
}
