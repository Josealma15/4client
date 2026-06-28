interface Props {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger, onConfirm, onCancel }: Props) {
  return (
    <div className="moverlay on" style={{ zIndex: 900 }} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="mwin" style={{ maxWidth: 360, textAlign: 'center' }}>
        <div className="mbody" style={{ padding: '28px 24px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--n)', marginBottom: 22, lineHeight: 1.45 }}>
            {message}
          </div>
          <div className="mactions" style={{ justifyContent: 'center' }}>
            <button className="bsec" onClick={onCancel}>{cancelLabel}</button>
            <button className={danger ? 'bdel' : 'bpri'} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
