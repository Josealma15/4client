import { useState, useEffect, useMemo, useRef } from 'react';

const API = import.meta.env.VITE_API_URL ?? '';

interface Product { id: string; name: string; category: string; unit_type?: string | null; }

function groupByCategory(products: Product[]) {
  const order: string[] = [];
  const groups: Record<string, Product[]> = {};
  for (const p of products) {
    const cat = p.category || 'Otros';
    if (!groups[cat]) { groups[cat] = []; order.push(cat); }
    groups[cat].push(p);
  }
  return order.map(cat => ({ category: cat, products: groups[cat] }));
}

export default function ClientFormPage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? '';

  const [state, setState] = useState<'loading' | 'invalid' | 'catalog' | 'done'>('loading');
  const [clientName, setClientName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) { setState('invalid'); setErrorMsg('Link inválido. Pide un nuevo link al negocio.'); return; }
    Promise.all([
      fetch(`${API}/api/v1/public/form-info?t=${encodeURIComponent(token)}`).then(r => r.json()),
      fetch(`${API}/api/v1/public/products?t=${encodeURIComponent(token)}`).then(r => r.json()),
    ])
      .then(([info, prods]) => {
        if (!info.data?.clientName) { setState('invalid'); setErrorMsg(info.error ?? 'Link inválido o expirado.'); return; }
        setClientName(info.data.clientName);
        setOrgName(info.data.orgName ?? '');
        setProducts(prods.data ?? []);
        setState('catalog');
        setTimeout(() => searchRef.current?.focus(), 100);
      })
      .catch(() => { setState('invalid'); setErrorMsg('No se pudo conectar. Verifica tu internet e intenta de nuevo.'); });
  }, [token]);

  const grouped = useMemo(() => groupByCategory(products), [products]);
  const searchLower = search.toLowerCase().trim();
  const visibleGroups = useMemo(() => {
    if (!searchLower) return grouped;
    return grouped
      .map(g => ({
        category: g.category,
        products: g.products.filter(p =>
          p.name.toLowerCase().includes(searchLower) ||
          p.category.toLowerCase().includes(searchLower)
        ),
      }))
      .filter(g => g.products.length > 0);
  }, [grouped, searchLower]);

  const selected = Object.entries(quantities)
    .filter(([, q]) => q.trim())
    .map(([name, qty]) => ({ product_name: name, quantity_label: qty.trim() }));

  async function handleSubmit() {
    if (selected.length === 0) { setSubmitError('Agrega al menos un producto'); return; }
    setSubmitError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/v1/public/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, items: selected }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Error');
      }
      setState('done');
    } catch (e: any) {
      setSubmitError(e.message === 'Link inválido o expirado' ? 'Este link ya expiró. Pide uno nuevo.' : 'Hubo un problema. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Estilos ────────────────────────────────────────────────────────────────
  const page: React.CSSProperties = {
    minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#f0f4f8', padding: '0 0 100px',
  };
  const header: React.CSSProperties = {
    background: '#1A7A4A', color: '#fff', padding: '16px 20px',
    position: 'sticky', top: 0, zIndex: 10,
    display: 'flex', alignItems: 'center', gap: 10,
  };
  const btn: React.CSSProperties = {
    width: '100%', fontSize: 20, fontWeight: 800,
    padding: '16px 0', background: '#1A7A4A', color: '#fff',
    border: 'none', borderRadius: 14, cursor: 'pointer',
  };

  if (state === 'loading') return (
    <div style={page}>
      <div style={{ textAlign: 'center', padding: 60, color: '#888', fontSize: 18 }}>Cargando...</div>
    </div>
  );

  if (state === 'invalid') return (
    <div style={page}>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '32px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>Link inválido</div>
        <div style={{ fontSize: 15, color: '#666' }}>{errorMsg}</div>
      </div>
    </div>
  );

  if (state === 'done') return (
    <div style={page}>
      <div style={header}>
        <span style={{ fontSize: 22 }}>🛒</span>
        <span style={{ fontWeight: 800, fontSize: 18 }}>{orgName}</span>
      </div>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '36px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#1A7A4A', marginBottom: 10 }}>¡Pedido enviado!</div>
        <div style={{ fontSize: 17, color: '#555', lineHeight: 1.6 }}>
          Tu pedido fue enviado a <strong>{orgName}</strong>.<br />
          En breve te atenderemos por WhatsApp.
        </div>
      </div>
    </div>
  );

  // Catálogo
  const selectedCount = selected.length;

  return (
    <div style={page}>
      {/* Header fijo */}
      <div style={header}>
        <span style={{ fontSize: 22 }}>🛒</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{orgName}</div>
          {clientName && <div style={{ fontSize: 13, opacity: 0.85 }}>Hola, {clientName} 👋</div>}
        </div>
        {selectedCount > 0 && (
          <span style={{ background: '#fff', color: '#1A7A4A', fontWeight: 800, fontSize: 13, padding: '3px 10px', borderRadius: 20 }}>
            {selectedCount} ítem{selectedCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Barra de búsqueda */}
      <div style={{ position: 'sticky', top: 60, zIndex: 9, background: '#f0f4f8', padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', background: '#fff', borderRadius: 12, border: '2px solid #ddd', padding: '8px 14px', gap: 8 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 18, background: 'transparent', fontFamily: 'inherit' }}
          />
          {search && (
            <button onClick={() => { setSearch(''); searchRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#888', lineHeight: 1, padding: 0 }}>×</button>
          )}
        </div>
      </div>

      {/* Catálogo */}
      <div style={{ padding: '0 16px' }}>
        {visibleGroups.length === 0 && (
          <div style={{ textAlign: 'center', color: '#888', padding: 32, fontSize: 17 }}>
            {search ? `Sin resultados para "${search}"` : 'Sin productos disponibles'}
          </div>
        )}

        {visibleGroups.map(group => (
          <div key={group.category} style={{ marginBottom: 8 }}>
            <div style={{
              fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.7px',
              color: '#1A7A4A', padding: '10px 4px 4px', borderBottom: '2px solid #1A7A4A22',
            }}>
              {group.category}
            </div>

            {group.products.map(p => {
              const qty = quantities[p.name] ?? '';
              const hasQty = qty.trim().length > 0;
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 4px', borderBottom: '1px solid #eee',
                  background: hasQty ? '#f0fdf4' : 'transparent',
                  borderRadius: hasQty ? 10 : 0,
                  transition: 'background .12s',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: hasQty ? 700 : 500, color: hasQty ? '#1A7A4A' : '#111' }}>
                      {p.name}
                      {hasQty && <span style={{ marginLeft: 6, fontSize: 14, color: '#1A7A4A' }}>✓</span>}
                    </div>
                    {p.unit_type && (
                      <div style={{ fontSize: 13, color: '#888', marginTop: 1 }}>{p.unit_type}</div>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder={p.unit_type ? `Ej: 2 ${p.unit_type}` : 'Cantidad'}
                    value={qty}
                    onChange={e => setQuantities(prev => ({ ...prev, [p.name]: e.target.value }))}
                    style={{
                      width: 130, fontSize: 17, padding: '10px 12px',
                      border: `2px solid ${hasQty ? '#1A7A4A' : '#ddd'}`,
                      borderRadius: 10, outline: 'none', textAlign: 'center',
                      fontFamily: 'inherit', color: '#111', background: '#fff',
                    }}
                    inputMode="decimal"
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Resumen fijo en bottom */}
      {selectedCount > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
          background: '#fff', borderTop: '2px solid #e0e0e0',
          padding: '12px 16px',
        }}>
          <div style={{ marginBottom: 8, maxHeight: 120, overflowY: 'auto' }}>
            {selected.map(s => (
              <div key={s.product_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, color: '#333', marginBottom: 2 }}>
                <span>{s.product_name}</span>
                <span style={{ fontWeight: 700, color: '#1A7A4A' }}>{s.quantity_label}</span>
              </div>
            ))}
          </div>
          {submitError && <div style={{ color: '#DC2626', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{submitError}</div>}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{ ...btn, opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? 'Enviando...' : `Enviar pedido (${selectedCount} producto${selectedCount > 1 ? 's' : ''}) ✓`}
          </button>
        </div>
      )}
    </div>
  );
}
