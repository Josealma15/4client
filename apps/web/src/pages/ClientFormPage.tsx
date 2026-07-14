import { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, CheckCircle, XCircle, Check, Plus, Trash2, ChevronDown, ChevronUp, ArrowLeft, Lock } from 'lucide-react';

const API = import.meta.env.VITE_API_URL ?? '';

interface Product { id: string; name: string; category: string; unit_type?: string | null; }
interface SelectedItem { product_name: string; quantity_label: string; productId: string; }
interface DayOrderItem { id: string; product_name: string; quantity_label: string; }
interface DayOrder {
  id: string; num: string; address: string; paymentMethod: string;
  status: string; editable: boolean; items: DayOrderItem[]; createdAt: string;
}

const STATUS_LABEL_CLIENT: Record<string, string> = {
  nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo para entrega',
  camino: 'En camino', cerrado: 'Entregado',
};

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

// Random value this browser generates once per link and keeps in localStorage —
// there's no real "device identity" reachable from a web page, so this is the
// closest available proxy. The backend (public.ts) claims the ticket's form-link
// for whichever browser presents this value first; a different browser/device
// opening the same link afterward gets rejected as if the link were invalid.
function getOrCreateDeviceToken(token: string): string {
  const key = `4client_device_${token}`;
  const fresh = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    let dt = localStorage.getItem(key);
    if (!dt) { dt = fresh(); localStorage.setItem(key, dt); }
    return dt;
  } catch {
    return fresh(); // localStorage unavailable (private mode) — works for this load, just won't persist
  }
}

export default function ClientFormPage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  const deviceToken = useMemo(() => getOrCreateDeviceToken(token), [token]);
  const draftKey = `4client_form_draft_${token}`;
  const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  const [state, setState] = useState<'loading' | 'invalid' | 'choose' | 'catalog' | 'done'>('loading');
  const [clientName, setClientName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [dayOrders, setDayOrders] = useState<DayOrder[]>([]);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  // null = not decided yet (only matters while dayOrders.length > 0); 'new' = a
  // separate order; any other value = the id of the existing order being edited.
  const [mergeTarget, setMergeTarget] = useState<string | 'new' | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  // pending input per product (not confirmed yet)
  const [pendingQty, setPendingQty] = useState<Record<string, string>>({});
  // confirmed items list
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [address, setAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // becomes true once we've attempted to restore a persisted draft, so the
  // persistence effect below doesn't clobber a saved draft with the initial empty state
  const [hydrated, setHydrated] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) { setState('invalid'); setErrorMsg('Link inválido. Pide un nuevo link al negocio.'); return; }

    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && Array.isArray(draft.items) && typeof draft.savedAt === 'number' && Date.now() - draft.savedAt < DRAFT_MAX_AGE_MS) {
          setSelected(draft.items);
          if (typeof draft.address === 'string') setAddress(draft.address);
          if (typeof draft.paymentMethod === 'string') setPaymentMethod(draft.paymentMethod);
        } else {
          localStorage.removeItem(draftKey);
        }
      }
    } catch { /* localStorage unavailable (private mode, etc.) — ignore */ }
    setHydrated(true);

    const qs = `t=${encodeURIComponent(token)}&device_token=${encodeURIComponent(deviceToken)}`;
    Promise.all([
      fetch(`${API}/api/v1/public/form-info?${qs}`).then(r => r.json()),
      fetch(`${API}/api/v1/public/products?${qs}`).then(r => r.json()),
    ])
      .then(([info, prods]) => {
        if (!info.data?.clientName) { setState('invalid'); setErrorMsg(info.error ?? 'Link inválido o expirado.'); return; }
        setClientName(info.data.clientName);
        setOrgName(info.data.orgName ?? '');
        setProducts(prods.data ?? []);
        const orders: DayOrder[] = info.data.orders ?? [];
        setDayOrders(orders);
        if (orders.length > 0) {
          setState('choose');
        } else {
          setMergeTarget('new');
          setState('catalog');
          setTimeout(() => searchRef.current?.focus(), 100);
        }
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
        localStorage.setItem(draftKey, JSON.stringify({ items: selected, address, paymentMethod, savedAt: Date.now() }));
      }
    } catch { /* localStorage unavailable — ignore, form still works without persistence */ }
  }, [selected, address, paymentMethod, hydrated, token]);

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

  function toggleExpandOrder(orderId: string) {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  }

  function chooseTarget(target: string | 'new') {
    setMergeTarget(target);
    if (target !== 'new') {
      // Pre-fill from the order they're adding to, so the fields show what's already
      // on file — they only need to type something if they actually want to change it.
      const order = dayOrders.find(o => o.id === target);
      if (order) {
        if (order.address) setAddress(order.address);
        if (order.paymentMethod) setPaymentMethod(order.paymentMethod);
        // Hydrate with what's already on the order — otherwise the client has no way
        // to see/edit/remove existing items, only ever add more on top blind.
        setSelected(order.items.map(i => ({
          product_name: i.product_name,
          quantity_label: i.quantity_label,
          productId: products.find(p => p.name === i.product_name)?.id ?? `existing-${i.id}`,
        })));
      }
    } else {
      setSelected([]);
      setAddress('');
      setPaymentMethod('');
    }
    setState('catalog');
    setTimeout(() => searchRef.current?.focus(), 100);
  }

  function backToChoose() {
    if (selected.length > 0 && !window.confirm('¿Volver? Se perderán los cambios que no hayas enviado.')) return;
    setSelected([]);
    setPendingQty({});
    setAddress('');
    setPaymentMethod('');
    setSummaryExpanded(false);
    setMergeTarget(null);
    setState('choose');
  }

  function clearOrder() {
    if (!window.confirm('¿Borrar todo el pedido? Se perderán los productos agregados.')) return;
    setSelected([]);
    setPendingQty({});
    setAddress('');
    setPaymentMethod('');
    setSummaryExpanded(false);
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
          device_token: deviceToken,
          address: address.trim() || undefined,
          payment_method: paymentMethod || undefined,
          merge_order_id: mergeTarget && mergeTarget !== 'new' ? mergeTarget : undefined,
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

  if (state === 'choose') {
    const PAYMENT_LABEL: Record<string, string> = { transfer: 'Transferencia', cash: 'En tienda', cod: 'Cobro en casa' };
    return (
      <div style={page}>
        <div style={header}>
          <ShoppingCart size={20} color="#fff" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{orgName}</div>
            {clientName && <div style={{ fontSize: 12, opacity: 0.85 }}>Hola, {clientName}</div>}
          </div>
        </div>
        <div style={{ padding: '20px 16px' }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '18px 16px', boxShadow: '0 2px 12px rgba(0,0,0,.06)', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111', marginBottom: 4 }}>
              Tus pedidos de hoy
            </div>
            <div style={{ fontSize: 14, color: '#666' }}>
              Elige uno para modificarlo, o crea uno nuevo aparte.
            </div>
          </div>

          {dayOrders.map(o => {
            if (!o.editable) {
              const isExpanded = expandedOrders.has(o.id);
              return (
                <div key={o.id} onClick={() => toggleExpandOrder(o.id)}
                  style={{
                    width: '100%', textAlign: 'left', background: '#f7f7f7', border: '2px solid #e5e5e5',
                    borderRadius: 14, padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#555' }}>
                      Pedido #{o.num} · {o.items.length} producto{o.items.length !== 1 ? 's' : ''}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#888', background: '#eee', padding: '4px 10px', borderRadius: 20 }}>
                      <Lock size={11} /> {STATUS_LABEL_CLIENT[o.status] ?? o.status}
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #ddd' }}>
                      {o.items.map(i => (
                        <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#666', padding: '3px 0' }}>
                          <span>{i.product_name}</span><span>{i.quantity_label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <button key={o.id} onClick={() => chooseTarget(o.id)}
                style={{
                  width: '100%', textAlign: 'left', background: '#fff', border: '2px solid #ddd',
                  borderRadius: 14, padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: GREEN }}>
                    Pedido #{o.num} · {o.items.length} producto{o.items.length !== 1 ? 's' : ''}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: GREEN, background: '#f0fdf4', padding: '3px 9px', borderRadius: 20 }}>
                    {STATUS_LABEL_CLIENT[o.status] ?? o.status}
                  </div>
                </div>
                {o.address && <div style={{ fontSize: 13, color: '#555' }}>{o.address}</div>}
                {o.paymentMethod && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{PAYMENT_LABEL[o.paymentMethod] ?? o.paymentMethod}</div>}
              </button>
            );
          })}

          <button onClick={() => chooseTarget('new')}
            style={{
              width: '100%', textAlign: 'center', background: '#f0f4f8', border: '2px dashed #ccc',
              borderRadius: 14, padding: '14px 16px', cursor: 'pointer', fontWeight: 700, color: '#444', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            <Plus size={15} /> Crear un pedido nuevo, aparte
          </button>
        </div>
      </div>
    );
  }

  const selectedCount = selected.length;
  const canGoBack = dayOrders.length > 0;

  return (
    <div style={page}>
      {/* Header */}
      <div style={header}>
        {canGoBack && (
          <button onClick={backToChoose} title="Volver al menú anterior" aria-label="Volver"
            style={{ background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', flexShrink: 0 }}>
            <ArrowLeft size={17} />
          </button>
        )}
        <ShoppingCart size={20} color="#fff" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{orgName}</div>
          {clientName && <div style={{ fontSize: 12, opacity: 0.85 }}>Hola, {clientName}</div>}
        </div>
        {selectedCount > 0 && (
          <div style={{ background: '#fff', color: GREEN, fontWeight: 800, fontSize: 13, padding: '4px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Check size={13} /> {selectedCount} ítem{selectedCount > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Summary panel — always visible once something's added, collapses past 2 items */}
      {selectedCount > 0 && (
        <div ref={summaryRef} style={{ background: '#fff', margin: '0 0 2px', padding: '12px 16px', borderBottom: '2px solid #e0e0e0' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: GREEN, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Productos {mergeTarget !== 'new' ? 'del pedido' : 'agregados'} ({selectedCount})
          </div>
          {(summaryExpanded ? selected : selected.slice(0, 2)).map(s => (
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
            {selectedCount > 2 ? (
              <button onClick={() => setSummaryExpanded(e => !e)}
                style={{ fontSize: 13, color: GREEN, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                {summaryExpanded
                  ? <><ChevronUp size={14} /> Ver menos</>
                  : <><ChevronDown size={14} /> Ver los {selectedCount}</>}
              </button>
            ) : <span />}
            <button onClick={clearOrder}
              style={{ fontSize: 13, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Trash2 size={14} /> Borrar todo
            </button>
          </div>

          {/* Delivery details — collected here so the order comes in ready to
              dispatch instead of needing staff to fill these in before anything
              can happen with it. Still editable by staff afterward if needed. */}
          <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 10, paddingTop: 10 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#444', marginBottom: 5 }}>
              Dirección de entrega <span style={{ fontWeight: 400, color: '#999' }}>(opcional)</span>
            </label>
            <input
              type="text"
              placeholder="Calle, número, barrio..."
              value={address}
              onChange={e => setAddress(e.target.value)}
              style={{ width: '100%', fontSize: 14, padding: '10px 12px', border: '2px solid #ddd', borderRadius: 10, outline: 'none', fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 10 }}
            />
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#444', marginBottom: 5 }}>
              Método de pago <span style={{ fontWeight: 400, color: '#999' }}>(opcional)</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { value: 'transfer', label: 'Transferencia' },
                { value: 'cash', label: 'En tienda' },
                { value: 'cod', label: 'Cobro en casa' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPaymentMethod(opt.value)}
                  style={{
                    flex: 1, padding: '9px 6px', fontSize: 12, fontWeight: 700,
                    borderRadius: 10, cursor: 'pointer',
                    border: `2px solid ${paymentMethod === opt.value ? GREEN : '#ddd'}`,
                    background: paymentMethod === opt.value ? '#f0fdf4' : '#fff',
                    color: paymentMethod === opt.value ? GREEN : '#444',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
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
              onClick={() => summaryRef.current?.scrollIntoView({ behavior: 'smooth' })}
              title="Ver productos agregados"
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
