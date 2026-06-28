import { useState, useEffect } from 'react';
import { useAuthStore } from './store/auth';
import { tryRestoreSession } from './lib/api';
import LoginPage from './pages/LoginPage';
import MainPage from './pages/MainPage';

export default function App() {
  const token = useAuthStore((s) => s.accessToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // If user profile in sessionStorage but access token gone (page refresh),
    // try to restore via HttpOnly cookie
    tryRestoreSession().finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  return token ? <MainPage /> : <LoginPage />;
}
