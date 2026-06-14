import { useEffect, useState } from 'react';
import { api } from '../api.js';

const DOT = { green: '🟢', yellow: '🟡', red: '🔴' };

// Шапка статуса: здоровье провайдеров (пинг), лимиты за час, баланс озвучки.
// Сама обновляется по таймеру; данные кешируются на бэкенде, так что это дёшево.
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
    return () => {
      clearInterval(s);
      clearInterval(u);
    };
  }, []);

  return (
    <div className="statusbar">
      {/* Здоровье провайдеров */}
      {status && (
        <div className="status-health" title="Доступность и задержка ответа">
          <span className="chip" title={`fast-gen · ${status.fastgen.latencyMs} мс`}>
            {DOT[status.fastgen.health]} fast-gen
          </span>
          <span className="chip" title={`Voicer · ${status.voicer.latencyMs} мс`}>
            {DOT[status.voicer.health]} Voicer
          </span>
        </div>
      )}

      {/* Лимиты картинок за час */}
      {usage && (
        <span className="chip" title="Картинок сгенерировано за текущий час / лимит">
          🖼 {usage.images.used}
          {usage.images.limit != null ? `/${usage.images.limit}` : ''}
          {usage.daysLeft != null ? ` · ⏳ ${usage.daysLeft} дн.` : ''}
        </span>
      )}

      {/* Баланс озвучки */}
      <span className="chip" title="Баланс озвучки Voicer">
        🎙 {balance ? balance.balance_text ?? `${balance.balance} симв.` : '—'}
      </span>
    </div>
  );
}
