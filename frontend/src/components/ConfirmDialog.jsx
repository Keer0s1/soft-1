import { useState } from 'react';

export default function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }) {
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    setConfirming(true);
    await onConfirm?.();
    setConfirming(false);
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 10px', fontSize: 18 }}>{title}</h3>
        <p className="muted" style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5 }}>{message}</p>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel} disabled={confirming}>Отмена</button>
          <button
            className={danger ? 'primary' : 'primary'}
            style={danger ? { background: 'var(--red)', borderColor: 'var(--red)' } : undefined}
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? '…' : confirmLabel || 'Подтвердить'}
          </button>
        </div>
      </div>
    </div>
  );
}
