import { useState, useEffect } from 'react';
import { useAuthStore } from './store/auth';
import { tryRestoreSession } from './lib/api';
import LoginPage from './pages/LoginPage';
import MainPage from './pages/MainPage';
import ClientFormPage from './pages/ClientFormPage';
import FacturaPage from './pages/FacturaPage';
import UpdateBanner from './components/ui/UpdateBanner';

export default function App() {
  const isForm = window.location.pathname === '/form';
  const isFactura = window.location.pathname === '/factura';

  const token = useAuthStore((s) => s.accessToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isForm || isFactura) { setReady(true); return; }
    tryRestoreSession().finally(() => setReady(true));
  }, [isForm, isFactura]);

  if (isForm) return <><ClientFormPage /><UpdateBanner /></>;
  if (isFactura) return <FacturaPage />;
  if (!ready) return <UpdateBanner />;
  return <>{token ? <MainPage /> : <LoginPage />}<UpdateBanner /></>;
}
