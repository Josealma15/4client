interface Props {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // When set, this becomes an "unsaved changes" dialog: two buttons only -
  // cancelLabel (red, discards) and this save action (green, saves then exits) -
  // instead of the generic stay/proceed pair.
  onSave?: () => void;
  saveLabel?: string;
  savePending?: boolean;
}

export function ConfirmModal({
  message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger,
  onConfirm, onCancel, onSave, saveLabel = 'Guardar', savePending,
}: Props) {
  return (
    <div className="moverlay on" style={{ zIndex: 900 }} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="mwin" style={{ maxWidth: 360, textAlign: 'center' }}>
        <div className="mbody" style={{ padding: '28px 24px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--n)', marginBottom: 22, lineHeight: 1.45 }}>
            {message}
          </div>
          <div className="mactions" style={{ justifyContent: 'center' }}>
            {onSave ? (
              <>
                <button className="bdel" onClick={onConfirm}>{cancelLabel}</button>
                <button className="bpri" style={{ width: 'auto' }} onClick={onSave} disabled={savePending}>
                  {savePending ? 'Guardando...' : saveLabel}
                </button>
              </>
            ) : (
              <>
                <button className="bsec" onClick={onCancel}>{cancelLabel}</button>
                <button className={danger ? 'bdel' : 'bpri'} onClick={onConfirm}>{confirmLabel}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
