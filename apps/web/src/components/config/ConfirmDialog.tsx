import { AlertTriangle } from 'lucide-react';

// ─── Simple confirmation dialog ───────────────────────────────────────────────

export function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--b)', borderRadius: 'var(--rad)', padding: 28, maxWidth: 400, width: '100%', boxShadow: 'var(--shf)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 20 }}>
          <AlertTriangle size={22} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--n)' }}>{message}</p>
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button className="bdel" style={{ flex: 1 }} onClick={onConfirm}>Confirmar</button>
          <button className="bsec" style={{ flex: 1 }} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
