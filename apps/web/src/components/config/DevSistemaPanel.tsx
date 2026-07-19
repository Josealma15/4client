import { useQuery } from '@tanstack/react-query';
import { CheckCircle, XCircle } from 'lucide-react';
import { api } from '../../lib/api';

export default function DevSistemaPanel() {
  const { data: org } = useQuery({
    queryKey: ['config-org'],
    queryFn: () => api.get<{ data: any }>('/config/org').then(r => r.data),
  });

  const { data: health, refetch: pingHealth, isFetching: pinging } = useQuery({
    queryKey: ['dev-health'],
    queryFn: () => api.get<any>('/dev/health').then(r => r),
    enabled: false,
  });

  const { data: envStatus, refetch: fetchEnv, isFetching: loadingEnv } = useQuery({
    queryKey: ['dev-env-status'],
    queryFn: () => api.get<{ data: any }>('/dev/env-status').then(r => r.data),
    enabled: false,
  });

  const { data: storageTest, refetch: testStorage, isFetching: testingStorage } = useQuery({
    queryKey: ['dev-storage-test'],
    queryFn: () => api.get<{ data: any }>('/dev/storage-test').then(r => r.data),
    enabled: false,
  });

  const h = health as any;
  const env = envStatus as any;
  const st = storageTest as any;

  const envRows = env ? [
    { k: 'NODE_ENV',                  v: env.NODE_ENV,                  sensitive: false },
    { k: 'PORT',                      v: String(env.PORT),               sensitive: false },
    { k: 'META_WEBHOOK_VERIFY_TOKEN', v: env.META_WEBHOOK_VERIFY_TOKEN,  sensitive: true },
    { k: 'META_PHONE_NUMBER_ID',      v: env.META_PHONE_NUMBER_ID,       sensitive: true },
    { k: 'META_ACCESS_TOKEN',         v: env.META_ACCESS_TOKEN,          sensitive: true },
    { k: 'META_APP_SECRET',           v: env.META_APP_SECRET,            sensitive: true },
    { k: 'R2_ACCOUNT_ID',             v: env.R2_ACCOUNT_ID,              sensitive: true },
    { k: 'R2_ACCESS_KEY_ID',          v: env.R2_ACCESS_KEY_ID,           sensitive: true },
    { k: 'R2_SECRET_ACCESS_KEY',      v: env.R2_SECRET_ACCESS_KEY,       sensitive: true },
    { k: 'R2_BUCKET_NAME',            v: env.R2_BUCKET_NAME,             sensitive: true },
    { k: 'R2_PUBLIC_URL',             v: env.R2_PUBLIC_URL,              sensitive: true },
    { k: 'SENTRY_DSN',               v: env.SENTRY_DSN,                 sensitive: true },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Org card */}
        <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Org actual</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['ID', org?.id],
              ['Slug', org?.slug],
              ['Plan', org?.plan],
              ['WPP', org?.wpp_meta_phone_id ? 'configurado' : 'sin config'],
              ['Bienvenida', org?.welcome_message ? 'activa' : '-'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--gt)', minWidth: 80, flexShrink: 0 }}>{label}</span>
                <span style={{ color: 'var(--n)', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 11 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* API Health card */}
        <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: 1 }}>API Health</div>
            <button className="bsec" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => pingHealth()} disabled={pinging}>
              {pinging ? 'Cargando...' : 'Ping'}
            </button>
          </div>
          {h ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                ['Status', h.status],
                ['DB latency', `${h.db_latency_ms} ms`],
                ['Orgs', h.counts?.organizations],
                ['Users', h.counts?.users],
                ['Node', h.node_version],
                ['Uptime', `${Math.floor(h.uptime_s / 60)}m ${h.uptime_s % 60}s`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--gt)', minWidth: 80, flexShrink: 0 }}>{label}</span>
                  <span style={{ color: 'var(--n)', fontFamily: 'monospace', fontSize: 11 }}>{String(value ?? '-')}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--gt)' }}>Clic en Ping para verificar.</div>
          )}
        </div>
      </div>

      {/* Env vars status card */}
      <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: 1 }}>Variables de entorno</div>
          <button className="bsec" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => fetchEnv()} disabled={loadingEnv}>
            {loadingEnv ? 'Cargando...' : 'Cargar'}
          </button>
        </div>
        {env ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
            {envRows.map(({ k, v, sensitive }) => (
              <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'center' }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: sensitive
                    ? (v === true ? 'var(--v)' : 'var(--r)')
                    : 'var(--az)',
                }} />
                <span style={{ color: 'var(--gt)', fontFamily: 'monospace', fontSize: 11, flex: 1 }}>{k}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontFamily: 'monospace', color: sensitive ? (v === true ? 'var(--v)' : 'var(--r)') : 'var(--az)' }}>
                  {sensitive
                    ? v === true
                      ? <><CheckCircle size={11} color="var(--v)" /> set</>
                      : <><XCircle size={11} color="var(--r)" /> missing</>
                    : v}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--gt)' }}>Clic en Cargar para ver estado de vars de entorno.</div>
        )}
      </div>

      {/* Storage test card - actually tries a real R2 upload, not just checking env vars are set */}
      <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Almacenamiento de facturas (R2)
          </div>
          <button className="bsec" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => testStorage()} disabled={testingStorage}>
            {testingStorage ? 'Probando...' : 'Probar subida'}
          </button>
        </div>
        {st ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12 }}>
            {st.ok
              ? <CheckCircle size={14} color="var(--v)" style={{ flexShrink: 0, marginTop: 1 }} />
              : <XCircle size={14} color="var(--r)" style={{ flexShrink: 0, marginTop: 1 }} />}
            <div>
              <div style={{ color: st.ok ? 'var(--v)' : 'var(--r)', fontWeight: 700 }}>
                {st.configured === false ? 'R2 no configurado (usando disco local)' : st.ok ? 'Subida de prueba exitosa' : 'Falló la subida de prueba'}
              </div>
              {st.error_name && <div style={{ color: 'var(--gt)', fontFamily: 'monospace', fontSize: 11, marginTop: 3 }}>{st.error_name}: {st.error_message}</div>}
              {st.detail && <div style={{ color: 'var(--gt)', fontSize: 11, marginTop: 3 }}>{st.detail}</div>}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--gt)' }}>Clic en Probar subida para intentar guardar un archivo de prueba y ver el error real de R2, si lo hay.</div>
        )}
      </div>
    </div>
  );
}
