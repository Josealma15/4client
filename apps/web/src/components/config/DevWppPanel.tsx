import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';

export default function DevWppPanel() {
  const qc = useQueryClient();
  const { data: org, isLoading } = useQuery({
    queryKey: ['config-org'],
    queryFn: () => api.get<{ data: any }>('/config/org').then(r => r.data),
  });

  const [phoneId, setPhoneId] = useState('');
  const [token, setToken] = useState('');
  const [welcome, setWelcome] = useState('');
  const [loaded, setLoaded] = useState(false);

  if (!loaded && org) {
    setPhoneId(org.wpp_meta_phone_id ?? '');
    setWelcome(org.welcome_message ?? '');
    setLoaded(true);
  }

  const save = useMutation({
    mutationFn: (data: any) => api.patch('/config/wpp', data),
    onSuccess: () => { toast('Config WPP guardada'); qc.invalidateQueries({ queryKey: ['config-org'] }); },
    onError: () => toast('Error al guardar', true),
  });

  function handleSave() {
    const data: any = { welcome_message: welcome || null };
    if (phoneId.trim()) data.wpp_meta_phone_id = phoneId.trim();
    if (token.trim()) data.wpp_meta_token = token.trim();
    save.mutate(data);
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--gt)' }}>Cargando...</div>;

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gt)', marginBottom: 6 }}>Phone Number ID</div>
          <input
            style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--brd)', borderRadius: 8, fontSize: 14, background: 'var(--bg)', color: 'var(--n)', fontFamily: 'monospace' }}
            value={phoneId} onChange={e => setPhoneId(e.target.value)}
            placeholder={org?.wpp_meta_phone_id ? '(configurado)' : 'ej: 1162357783628740'}
          />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gt)', marginBottom: 6 }}>Access Token</div>
          <input
            type="password"
            style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--brd)', borderRadius: 8, fontSize: 14, background: 'var(--bg)', color: 'var(--n)', fontFamily: 'monospace' }}
            value={token} onChange={e => setToken(e.target.value)}
            placeholder="Dejar vacío para no cambiar"
          />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gt)', marginBottom: 4 }}>Mensaje de bienvenida</div>
          <div style={{ fontSize: 12, color: 'var(--gt)', marginBottom: 8 }}>Se envía al primer mensaje del día de cada cliente. Vacío = desactivado.</div>
          <textarea
            style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--brd)', borderRadius: 8, fontSize: 14, background: 'var(--bg)', color: 'var(--n)', minHeight: 90, resize: 'vertical' }}
            value={welcome} onChange={e => setWelcome(e.target.value)}
            placeholder="ej: Hola, bienvenido a Fruver San Gabriel. En un momento serás atendido por nuestro personal."
          />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="bpri" onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <div style={{ fontSize: 12, color: org?.wpp_meta_phone_id ? 'var(--v)' : 'var(--gt)' }}>
            {org?.wpp_meta_phone_id
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={13} color="var(--v)" /> Phone ID configurado</span>
            : <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={13} color="var(--r)" /> Sin configurar</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
