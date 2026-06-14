import { Link, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './api.js';

export default function App() {
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    api.voicerBalance().then(setBalance).catch(() => setBalance(null));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">🎬 Генератор роликов</Link>
        <div className="topbar-right">
          {balance ? (
            <span className="balance" title="Баланс озвучки Voicer">
              🎙 {balance.balance_text ?? `${balance.balance} симв.`}
            </span>
          ) : (
            <span className="balance muted">баланс недоступен</span>
          )}
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
