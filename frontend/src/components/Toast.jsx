import { useState, useEffect, useCallback } from 'react';

let toastId = 0;
let addToastGlobal = null;

export function toast(message, type = 'info', durationMs = 4000) {
  addToastGlobal?.({ id: ++toastId, message, type, durationMs });
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((t) => {
    setToasts((arr) => [...arr, t]);
    setTimeout(() => {
      setToasts((arr) => arr.filter((x) => x.id !== t.id));
    }, t.durationMs);
  }, []);

  useEffect(() => {
    addToastGlobal = addToast;
    return () => { addToastGlobal = null; };
  }, [addToast]);

  if (!toasts.length) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span>{t.message}</span>
          <button className="toast-close" onClick={() => setToasts((arr) => arr.filter((x) => x.id !== t.id))}>✕</button>
        </div>
      ))}
    </div>
  );
}
