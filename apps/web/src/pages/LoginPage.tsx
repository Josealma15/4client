import { useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

export default function LoginPage() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) { setError('Ingresa usuario y contraseña'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ data: { accessToken: string; user: any } }>(
        '/auth/login', { email, password }
      );
      const apiUser = res.data.user as any;
      setAuth(
        { accessToken: res.data.accessToken },
        { ...apiUser, userId: apiUser.id, orgId: apiUser.org_id, orgName: apiUser.org_name },
      );
    } catch (e: any) {
      setError(e.message === 'Credenciales incorrectas' ? 'Usuario o contraseña incorrectos' : 'Error al conectar con el servidor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: 'linear-gradient(140deg,var(--vd) 0%,var(--v) 60%,#2eac62 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="lcard">
        <div className="llogo">
          <img src="/logo.png" alt="4Client" style={{ height: 80, objectFit: 'contain' }} />
        </div>
        <p className="lsub">Sistema de Gestión Operativa</p>
        <div className="fg">
          <label className="fl">Correo</label>
          <input className="fi" type="email" placeholder="correo@empresa.com" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
        </div>
        <div className="fg">
          <label className="fl">Contraseña</label>
          <input className="fi" type="password" placeholder="••••••••" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
        </div>
        <button className="bpri" onClick={handleLogin} disabled={loading}>
          {loading ? 'Ingresando...' : 'Ingresar al sistema'}
        </button>
        <div className="login-err">{error}</div>
        <div className="lfooter">4client.shop</div>
      </div>
    </div>
  );
}
