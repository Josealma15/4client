import { useState } from 'react';
import { Database, MessageSquare, Settings, ExternalLink } from 'lucide-react';
import DevDbPanel from './DevDbPanel';
import DevWppPanel from './DevWppPanel';
import DevSistemaPanel from './DevSistemaPanel';
import DevLinksPanel from './DevLinksPanel';

// ─── DevTools sub-panels ──────────────────────────────────────────────────────

type DevTab = 'bd' | 'wpp' | 'sistema' | 'links';

const DEV_TABS: { key: DevTab; label: string; icon: React.ReactNode }[] = [
  { key: 'bd',      label: 'Base de datos', icon: <Database size={13} /> },
  { key: 'wpp',     label: 'WhatsApp',      icon: <MessageSquare size={13} /> },
  { key: 'sistema', label: 'Sistema',        icon: <Settings size={13} /> },
  { key: 'links',   label: 'Links',          icon: <ExternalLink size={13} /> },
];

export default function DevSection() {
  const [tab, setTab] = useState<DevTab>('bd');

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {DEV_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1.5px solid ${tab === t.key ? 'var(--v)' : 'var(--brd)'}`,
              background: tab === t.key ? 'var(--vc)' : 'var(--b)',
              color: tab === t.key ? 'var(--vd)' : 'var(--gt)',
              transition: 'all .12s',
            }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'bd'      && <DevDbPanel />}
      {tab === 'wpp'     && <DevWppPanel />}
      {tab === 'sistema' && <DevSistemaPanel />}
      {tab === 'links'   && <DevLinksPanel />}
    </div>
  );
}
