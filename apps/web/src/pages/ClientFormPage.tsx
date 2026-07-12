import { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, CheckCircle, XCircle, Check, Plus, Trash2 } from 'lucide-react';

const API = import.meta.env.VITE_API_URL ?? '';

interface Product { id: string; name: string; category: string; unit_type?: string | null; }
interface SelectedItem { product_name: string; quantity_label: string; productId: string; }

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
  const draftKey = `4client_form_draft_${token}`;
  const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  const [state, setState] = useState<'loading' | 'invalid' | 'catalog' | 'done'>('loading');
  const [clientName, setClientName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  // pending input per product (not confirmed yet)
  const [pendingQty, setPendingQty] = useState<Record<string, string>>({});
  // confirmed items list
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // becomes true once we've attempted to restore a persisted draft, so the
  // persistence effect below doesn't clobber a saved draft with the initial empty state
  const [hydrated, setHydrated] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) { setState('invalid'); setErrorMsg('Link inválido. Pide un nuevo link al negocio.'); return; }

    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && Array.isArray(draft.items) && typeof draft.savedAt === 'number' && Date.now() - draft.savedAt < DRAFT_MAX_AGE_MS) {
          setSelected(draft.items);
        } else {
          localStorage.removeItem(draftKey);
        }
      }
    } catch { /* localStorage unavailable (private mode, etc.) — ignore */ }
    setHydrated(true);

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

  // Persist confirmed items as a draft so the client can resume within 1 day
  // if they close the tab mid-order. Skip until the initial restore attempt
  // above has run, so we don't overwrite a saved draft with the empty initial state.
  useEffect(() => {
    if (!hydrated || !token) return;
    try {
      if (selected.length === 0) {
        localStorage.removeItem(draftKey);
      } else {
        localStorage.setItem(draftKey, JSON.stringify({ items: selected, savedAt: Date.now() }));
      }
    } catch { /* localStorage unavailable — ignore, form still works without persistence */ }
  }, [selected, hydrated, token]);

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

  function addProduct(p: Product) {
    const qty = (pendingQty[p.id] ?? '').trim();
    if (!qty) return;
    setSelected(prev => {
      const exists = prev.findIndex(i => i.productId === p.id);
      if (exists >= 0) {
        return prev.map((i, idx) => idx === exists ? { ...i, quantity_label: qty } : i);
      }
      return [...prev, { product_name: p.name, quantity_label: qty, productId: p.id }];
    });
    setPendingQty(prev => { const c = { ...prev }; delete c[p.id]; return c; });
    setSearch('');
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function removeSelected(productId: string) {
    setSelected(prev => prev.filter(i => i.productId !== productId));
  }

  function clearOrder() {
    if (!window.confirm('¿Borrar todo el pedido? Se perderán los productos agregados.')) return;
    setSelected([]);
    setPendingQty({});
    setShowSummary(false);
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }

  async function handleSubmit() {
    if (submitting) return; // already in flight — a fast double-click/tap shouldn't fire twice
    if (selected.length === 0) { setSubmitError('Agrega al menos un producto'); return; }
    setSubmitError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/v1/public/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          items: selected.map(i => ({ product_name: i.product_name, quantity_label: i.quantity_label })),
        }),
      });
      if (res.status === 429) {
        setSubmitError('Enviaste varios pedidos muy seguido. Espera un minuto e intenta de nuevo.');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Error');
      }
      setState('done');
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    } catch (e: any) {
      setSubmitError(e.message === 'Link inválido o expirado' ? 'Este link ya expiró. Pide uno nuevo.' : 'Hubo un problema. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Styles ────────────────────────────────────────────────────────────────
  const GREEN = '#1A7A4A';
  const page: React.CSSProperties = {
    minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#f0f4f8',
  };
  const header: React.CSSProperties = {
    background: GREEN, color: '#fff', padding: '14px 16px',
    position: 'sticky', top: 0, zIndex: 20,
    display: 'flex', alignItems: 'center', gap: 10,
  };
  const btnPrimary: React.CSSProperties = {
    width: '100%', fontSize: 17, fontWeight: 800,
    padding: '15px 0', background: GREEN, color: '#fff',
    border: 'none', borderRadius: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  };

  if (state === 'loading') return (
    <div style={page}>
      <div style={{ textAlign: 'center', padding: 60, color: '#888', fontSize: 18 }}>Cargando...</div>
    </div>
  );

  if (state === 'invalid') return (
    <div style={page}>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '32px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><XCircle size={56} color="#DC2626" strokeWidth={1.5} /></div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>Link inválido</div>
        <div style={{ fontSize: 15, color: '#666' }}>{errorMsg}</div>
      </div>
    </div>
  );

  if (state === 'done') return (
    <div style={page}>
      <div style={header}>
        <ShoppingCart size={22} color="#fff" />
        <span style={{ fontWeight: 800, fontSize: 18 }}>{orgName}</span>
      </div>
      <div style={{ background: '#fff', borderRadius: 18, margin: '24px 16px', padding: '36px 20px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><CheckCircle size={72} color={GREEN} strokeWidth={1.5} /></div>
        <div style={{ fontSize: 24, fontWeight: 800, color: GREEN, marginBottom: 10 }}>¡Pedido enviado!</div>
        <div style={{ fontSize: 17, color: '#555', lineHeight: 1.6 }}>
          Tu pedido fue enviado a <strong>{orgName}</strong>.<br />
          En breve te atenderemos por WhatsApp.
        </div>
      </div>
    </div>
  );

  const selectedCount = selected.length;

  return (
    <div style={page}>
      {/* Header */}
      <div style={header}>
        <ShoppingCart size={20} color="#fff" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{orgName}</div>
          {clientName && <div style={{ fontSize: 12, opacity: 0.85 }}>Hola, {clientName}</div>}
        </div>
        {selectedCount > 0 && (
          <button
            onClick={() => setShowSummary(s => !s)}
            style={{ background: '#fff', color: GREEN, fontWeight: 800, fontSize: 13, padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Check size={13} /> {selectedCount} ítem{selectedCount > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Summary panel (collapsible) */}
      {showSummary && selectedCount > 0 && (
        <div style={{ background: '#fff', margin: '0 0 2px', padding: '12px 16px', borderBottom: '2px solid #e0e0e0' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: GREEN, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Productos agregados
          </div>
          {selected.map(s => (
            <div key={s.productId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{s.product_name}</div>
                <div style={{ fontSize: 12, color: '#666' }}>{s.quantity_label}</div>
              </div>
              <button onClick={() => removeSelected(s.productId)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: 4 }}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <button onClick={() => setShowSummary(false)}
              style={{ fontSize: 13, color: '#666', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
              Ocultar resumen
            </button>
            <button onClick={clearOrder}
              style={{ fontSize: 13, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Trash2 size={14} /> Borrar todo
            </button>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div style={{ position: 'sticky', top: 52, zIndex: 10, background: '#f0f4f8', padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', background: '#fff', borderRadius: 12, border: '2px solid #ddd', padding: '8px 14px', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, background: 'transparent', fontFamily: 'inherit' }}
          />
          {search && (
            <button onClick={() => { setSearch(''); searchRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#888', lineHeight: 1, padding: 0 }}>×</button>
          )}
        </div>
      </div>

      {/* Catalog */}
      <div style={{ padding: '0 16px 120px' }}>
        {visibleGroups.length === 0 && (
          <div style={{ textAlign: 'center', color: '#888', padding: 32, fontSize: 16 }}>
            {search ? `Sin resultados para "${search}"` : 'Sin productos disponibles'}
          </div>
        )}

        {visibleGroups.map(group => (
          <div key={group.category} style={{ marginBottom: 4 }}>
            <div style={{
              fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.7px',
              color: GREEN, padding: '10px 4px 4px', borderBottom: `2px solid ${GREEN}22`,
            }}>
              {group.category}
            </div>

            {group.products.map(p => {
              const qty = pendingQty[p.id] ?? '';
              const isAdded = selected.some(i => i.productId === p.id);
              const addedItem = selected.find(i => i.productId === p.id);
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 4px', borderBottom: '1px solid #eee',
                  background: isAdded ? '#f0fdf4' : 'transparent',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: isAdded ? 700 : 500, color: isAdded ? GREEN : '#111', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {p.name}
                      {isAdded && <Check size={13} color={GREEN} />}
                    </div>
                    {p.unit_type && <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{p.unit_type}</div>}
                    {isAdded && addedItem && (
                      <div style={{ fontSize: 11, color: GREEN, fontWeight: 600, marginTop: 2 }}>Agregado: {addedItem.quantity_label}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <input
                      type="text"
                      placeholder={p.unit_type ? `Ej: 2 ${p.unit_type}` : 'Cantidad'}
                      value={qty}
                      onChange={e => setPendingQty(prev => ({ ...prev, [p.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProduct(p); } }}
                      style={{
                        width: 110, fontSize: 15, padding: '9px 10px',
                        border: `2px solid ${qty.trim() ? GREEN : '#ddd'}`,
                        borderRadius: 10, outline: 'none', textAlign: 'center',
                        fontFamily: 'inherit', color: '#111', background: '#fff',
                      }}
                    />
                    <button
                      onClick={() => addProduct(p)}
                      disabled={!qty.trim()}
                      style={{
                        width: 38, height: 38, borderRadius: '50%', border: 'none',
                        background: qty.trim() ? GREEN : '#ddd',
                        color: '#fff', cursor: qty.trim() ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'background .12s',
                      }}
                      title="Agregar (o presiona Enter)"
                    >
                      <Plus size={18} strokeWidth={3} />
                    </button>
                    {isAdded && (
                      <button
                        onClick={() => removeSelected(p.id)}
                        style={{
                          width: 38, height: 38, borderRadius: '50%', border: '2px solid #F5C6C6',
                          background: '#fff', color: '#DC2626', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}
                        title="Quitar este producto"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      {selectedCount > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
          background: '#fff', borderTop: '2px solid #e0e0e0',
          padding: '12px 16px',
          boxShadow: '0 -4px 16px rgba(0,0,0,.08)',
        }}>
          {submitError && <div style={{ color: '#DC2626', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{submitError}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setShowSummary(s => !s)}
              style={{
                flex: '0 0 auto', padding: '14px 16px',
                background: '#f0f4f8', color: '#333', border: '2px solid #ddd',
                borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <Check size={14} color={GREEN} /> {selectedCount}
            </button>
            <button
              onClick={clearOrder}
              disabled={submitting}
              title="Borrar pedido"
              aria-label="Borrar pedido"
              style={{
                flex: '0 0 auto', padding: '14px 14px',
                background: '#fff', color: '#DC2626', border: '2px solid #F5C6C6',
                borderRadius: 12, cursor: submitting ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                fontWeight: 700, fontSize: 13,
                opacity: submitting ? 0.5 : 1,
              }}>
              <Trash2 size={16} /> Borrar
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{ ...btnPrimary, flex: 1, opacity: submitting ? 0.7 : 1 }}>
              {submitting ? 'Enviando...' : 'Enviar pedido'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
