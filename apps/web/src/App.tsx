import { useAuthStore } from './store/auth';
import LoginPage from './pages/LoginPage';
import MainPage from './pages/MainPage';

export default function App() {
  const token = useAuthStore((s) => s.accessToken);
  return token ? <MainPage /> : <LoginPage />;
}
