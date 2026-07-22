import { useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import PasswordInput from '../components/ui/PasswordInput';

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
        { ...apiUser, userId: apiUser.id, orgId: apiUser.org_id, orgName: apiUser.org_name, orgSlug: apiUser.org_slug },
      );
    } catch (e: any) {
      // Always the same message no matter what actually failed (wrong password, unknown
      // email, validation error, network failure...) - a message that varies by failure
      // reason is exactly the kind of signal that lets an attacker enumerate valid emails
      // or probe the backend. Real reason still goes to the console for our own debugging.
      console.error('[login] failed', e);
      setError('Usuario o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lbg">
      <div className="lbg-overlay" />
      <div className="lcard">
        <div className="llogo">
          <img src="/logo.png" alt="4Client" style={{ height: 120, objectFit: 'contain' }} />
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
          <PasswordInput className="fi" placeholder="••••••••" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
        </div>
        <button className="bpri" onClick={handleLogin} disabled={loading}>
          {loading ? 'Ingresando...' : 'Ingresar al sistema'}
        </button>
        <div className="login-err">{error}</div>
        <div className="lfooter">4client.shop — DEV TEST</div>
      </div>
    </div>
  );
}
