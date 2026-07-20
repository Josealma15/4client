import { useState } from 'react';
import { Package, Truck, Users, Code2 } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import ProductsSection from './ProductsSection';
import EmployeesSection from './EmployeesSection';
import UsersSection from './UsersSection';
import DevSection from './DevSection';

// ─── ConfigTab root ───────────────────────────────────────────────────────────

type Section = 'productos' | 'domiciliarios' | 'usuarios' | 'dev';

export default function ConfigTab() {
  const user = useAuthStore(s => s.user);
  const isDev = user?.role === 'dev';
  // dev is a superset of admin, not a separate restricted role - it lands on
  // DevTools by default (that's the reason a dev account exists) but can reach
  // every admin section too, instead of having to ask an admin to make changes.
  const [section, setSection] = useState<Section>(isDev ? 'dev' : 'productos');

  const tabs: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: 'productos',     label: 'Productos',     icon: <Package size={15} /> },
    { key: 'domiciliarios', label: 'Domiciliarios', icon: <Truck size={15} /> },
    { key: 'usuarios',      label: 'Usuarios',      icon: <Users size={15} /> },
    ...(isDev ? [{ key: 'dev' as Section, label: 'DevTools', icon: <Code2 size={15} /> }] : []),
  ];

  return (
    <div>
      <div className="khead">
        <div>
          <div className="ktit">Configuración</div>
          <div className="kmeta">Gestión de productos, domiciliarios, usuarios y sistema</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 22, borderBottom: '2px solid var(--brd)' }}>
        {tabs.map(t => (
          <button key={t.key}
            onClick={() => setSection(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', border: 'none', cursor: 'pointer',
              background: 'none', fontSize: 14, fontWeight: section === t.key ? 700 : 500,
              color: section === t.key ? 'var(--v)' : 'var(--gt)',
              borderBottom: `3px solid ${section === t.key ? 'var(--v)' : 'transparent'}`,
              marginBottom: -2, borderRadius: '8px 8px 0 0', transition: 'all .15s',
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {section === 'productos'     && <ProductsSection />}
      {section === 'domiciliarios' && <EmployeesSection />}
      {section === 'usuarios'      && <UsersSection />}

      {section === 'dev'           && isDev && <DevSection />}
    </div>
  );
}
