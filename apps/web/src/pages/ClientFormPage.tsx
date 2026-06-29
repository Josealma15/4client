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
  const slug = new URLSearchParams(window.location.search).get('org') ?? '';
  const [orgName, setOrgName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Step: 'info' | 'catalog' | 'done'
  const [step, setStep] = useState<'info' | 'catalog' | 'done'>('info');

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [infoError, setInfoError] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!slug) { setNotFound(true); return; }
    fetch(`${API}/api/v1/public/org/${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(r => { if (r.data?.name) setOrgName(r.data.name); else setNotFound(true); })
      .catch(() => setNotFound(true));
  }, [slug]);

  function handleInfoSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) { setInfoError('Ingresa tu nombre'); return; }
    if (!telefono.trim()) { setInfoError('Ingresa tu número de WhatsApp'); return; }
    setInfoError('');
    setLoadingProducts(true);
    setStep('catalog');
    fetch(`${API}/api/v1/public/products?org_slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(r => { if (r.data) setProducts(r.data); })
      .catch(() => {})
      .finally(() => {
        setLoadingProducts(false);
        setTimeout(() => searchRef.current?.focus(), 100);
      });
  }

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
      const res = await fetch(`${API}/api/v1/public/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_slug: slug,
          customer_name: nombre.trim(),
          phone: telefono.trim(),
          items: selected,
        }),
      });
      if (!res.ok) throw new Error();
      setStep('done');
    } catch {
      setSubmitError('Hubo un problema. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Estilos ────────────────────────────────────────────────────────────────
  const page: React.CSSProperties = {
    minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#f0f4f8', padding: '0 0 80px',
  };
  const header: React.CSSProperties = {
    background: '#1A7A4A', color: '#fff', padding: '18px 20px',
    position: 'sticky', top: 0, zIndex: 10,
    display: 'flex', alignItems: 'center', gap: 10,
  };
  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 18, boxShadow: '0 2px 12px rgba(0,0,0,.1)',
    margin: '20px 16px', padding: '28px 20px',
  };
  const label: React.CSSProperties = { display: 'block', fontSize: 18, fontWeight: 700, color: '#333', marginBottom: 8 };
  const input: React.CSSProperties = {
    width: '100%', fontSize: 20, padding: '14px 16px',
    border: '2px solid #ddd', borderRadius: 12, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit', color: '#111',
  };
  const btn: React.CSSProperties = {
    width: '100%', fontSize: 20, fontWeight: 800,
    padding: '16px 0', background: '#1A7A4A', color: '#fff',
    border: 'none', borderRadius: 14, cursor: 'pointer', marginTop: 10,
  };
  const errStyle: React.CSSProperties = { color: '#DC2626', fontSize: 16, fontWeight: 600, marginTop: 10 };

  if (notFound) return (
    <div style={page}>
      <div style={card}>
        <div style={{ textAlign: 'center', color: '#DC2626', fontSize: 18, fontWeight: 700 }}>
          Enlace inválido. Pide un nuevo enlace al negocio.
        </div>
      </div>
    </div>
  );

  if (!orgName) return (
    <div style={page}>
      <div style={{ textAlign: 'center', padding: 40, color: '#888', fontSize: 18 }}>Cargando...</div>
    </div>
  );

  if (step === 'done') return (
    <div style={page}>
      <div style={header}>
        <span style={{ fontSize: 22 }}>🛒</span>
        <span style={{ fontWeight: 800, fontSize: 18 }}>{orgName}</span>
      </div>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#1A7A4A', marginBottom: 10 }}>¡Pedido enviado!</div>
        <div style={{ fontSize: 17, color: '#555', lineHeight: 1.6 }}>
          Tu lista fue enviada a <strong>{orgName}</strong>.<br />En breve te atenderemos por WhatsApp.
        </div>
      </div>
    </div>
  );

  // ─── Step info ───────────────────────────────────────────────────────────────
  if (step === 'info') return (
    <div style={page}>
      <div style={header}>
        <span style={{ fontSize: 22 }}>🛒</span>
        <span style={{ fontWeight: 800, fontSize: 18 }}>{orgName}</span>
      </div>
      <div style={card}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1A7A4A', marginBottom: 6 }}>Hola 👋</div>
        <div style={{ fontSize: 16, color: '#555', marginBottom: 28 }}>
          Ingresa tus datos para ver el catálogo y hacer tu pedido.
        </div>
        <form onSubmit={handleInfoSubmit} autoComplete="on">
          <div style={{ marginBottom: 20 }}>
            <label style={label} htmlFor="nombre">Tu nombre</label>
            <input id="nombre" style={input} type="text"
              placeholder="Ej: María González"
              value={nombre} onChange={e => setNombre(e.target.value)}
              autoComplete="name" autoFocus />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={label} htmlFor="telefono">Tu número de WhatsApp</label>
            <input id="telefono" style={input} type="tel"
              placeholder="Ej: 3001234567"
              value={telefono} onChange={e => setTelefono(e.target.value)}
              autoComplete="tel" inputMode="numeric" />
          </div>
          {infoError && <div style={errStyle}>{infoError}</div>}
          <button type="submit" style={btn}>Ver catálogo →</button>
        </form>
      </div>
    </div>
  );

  // ─── Step catalog ────────────────────────────────────────────────────────────
  const selectedCount = selected.length;

  return (
    <div style={page}>
      {/* Header fijo */}
      <div style={header}>
        <span style={{ fontSize: 22 }}>🛒</span>
        <span style={{ fontWeight: 800, fontSize: 18, flex: 1 }}>{orgName}</span>
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
        {loadingProducts && (
          <div style={{ textAlign: 'center', color: '#888', padding: 32, fontSize: 17 }}>Cargando catálogo...</div>
        )}

        {!loadingProducts && visibleGroups.length === 0 && (
          <div style={{ textAlign: 'center', color: '#888', padding: 32, fontSize: 17 }}>
            {search ? `Sin resultados para "${search}"` : 'Sin productos disponibles'}
          </div>
        )}

        {visibleGroups.map(group => (
          <div key={group.category} style={{ marginBottom: 8 }}>
            {/* Cabecera de categoría */}
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
                  {/* Nombre */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: hasQty ? 700 : 500, color: hasQty ? '#1A7A4A' : '#111' }}>
                      {p.name}
                      {hasQty && <span style={{ marginLeft: 6, fontSize: 14, color: '#1A7A4A' }}>✓</span>}
                    </div>
                    {p.unit_type && (
                      <div style={{ fontSize: 13, color: '#888', marginTop: 1 }}>{p.unit_type}</div>
                    )}
                  </div>

                  {/* Cantidad */}
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
          <div style={{ marginBottom: 8 }}>
            {selected.map(s => (
              <div key={s.product_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, color: '#333', marginBottom: 2 }}>
                <span>{s.product_name}</span>
                <span style={{ fontWeight: 700, color: '#1A7A4A' }}>{s.quantity_label}</span>
              </div>
            ))}
          </div>
          {submitError && <div style={{ ...errStyle, marginBottom: 6 }}>{submitError}</div>}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{ ...btn, marginTop: 0, fontSize: 18, padding: '14px 0', opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? 'Enviando...' : `Enviar pedido (${selectedCount} producto${selectedCount > 1 ? 's' : ''}) ✓`}
          </button>
        </div>
      )}
    </div>
  );
}
