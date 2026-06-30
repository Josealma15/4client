import { useState, useEffect } from 'react';
import { useAuthStore } from './store/auth';
import { tryRestoreSession } from './lib/api';
import LoginPage from './pages/LoginPage';
import MainPage from './pages/MainPage';
import ClientFormPage from './pages/ClientFormPage';

export default function App() {
  const isForm = window.location.pathname === '/form';

  const token = useAuthStore((s) => s.accessToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isForm) { setReady(true); return; }
    tryRestoreSession().finally(() => setReady(true));
  }, [isForm]);

  if (isForm) return <ClientFormPage />;
  if (!ready) return null;
  return token ? <MainPage /> : <LoginPage />;
}
