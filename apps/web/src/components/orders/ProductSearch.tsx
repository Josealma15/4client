import { useState, useMemo, useEffect, useRef, KeyboardEvent } from 'react';

interface Product { id: string; name: string; category: string; }
interface Item { product_name: string; quantity_label: string; price: string; }

interface Props {
  products: Product[];
  items: Item[];
  locked?: boolean;
  onChange: (items: Item[]) => void;
  onLocalDirty?: (dirty: boolean) => void;
}

function groupByCategory(products: Product[]) {
  const order: string[] = [];
  const groups: Record<string, Product[]> = {};
  for (const p of products) {
    if (!groups[p.category]) { groups[p.category] = []; order.push(p.category); }
    groups[p.category].push(p);
  }
  return order.map(cat => ({ category: cat, products: groups[cat] }));
}

export default function ProductSearch({ products, items, locked, onChange, onLocalDirty }: Props) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Local typing state per product — not committed until Enter or ✓
  const [localInputs, setLocalInputs] = useState<Record<string, { qty: string; price: string }>>({});

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

  // Notify parent when catalog has uncommitted typing
  useEffect(() => {
    const hasLocal = Object.values(localInputs).some(v => v.qty.trim() || v.price.trim());
    onLocalDirty?.(hasLocal);
  }, [localInputs, onLocalDirty]);

  function getLocal(name: string) {
    return localInputs[name] ?? { qty: '', price: '' };
  }

  function setLocal(name: string, field: 'qty' | 'price', val: string) {
    setLocalInputs(prev => ({ ...prev, [name]: { ...getLocal(name), [field]: val } }));
  }

  function commitProduct(productName: string) {
    const local = localInputs[productName];
    if (!local?.qty.trim() && !local?.price.trim()) return;

    const newItem: Item = {
      product_name: productName,
      quantity_label: local.qty.trim(),
      price: local.price.trim(),
    };

    const exists = items.some(i => i.product_name === productName);
    const next = exists
      ? items.map(i => i.product_name === productName ? newItem : i)
      : [...items, newItem];
    onChange(next);

    // Clear local input so the catalog row goes back to empty
    setLocalInputs(prev => {
      const copy = { ...prev };
      delete copy[productName];
      return copy;
    });

    // Return focus to search bar so user can quickly find next product
    setSearch('');
    setCollapsed(false);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>, productName: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitProduct(productName);
    }
  }

  function removeItem(productName: string) {
    onChange(items.filter(i => i.product_name !== productName));
  }

  const total = items.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);

  // Locked mode: simple read-only factbox
  if (locked) {
    return (
      <div className="factbox">
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 9 }}>
          Factura
        </div>
        {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--gt)', marginBottom: 8 }}>Sin productos registrados</div>}
        {items.map(i => (
          <div key={i.product_name} className="factrow">
            <span>{i.product_name}{i.quantity_label && ` - ${i.quantity_label}`}</span>
            <span>{parseFloat(i.price) ? `$${parseFloat(i.price).toLocaleString('es-CO')}` : '—'}</span>
          </div>
        ))}
        {items.length > 0 && (
          <div className="facttot">
            <span>Total</span>
            <span>${total.toLocaleString('es-CO')}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Catalog toggle header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '8px 12px', background: 'var(--bg)', borderRadius: 'var(--rad)',
          border: '1px solid var(--brd)', marginBottom: 6, userSelect: 'none',
          fontSize: 13, fontWeight: 700, color: 'var(--n)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transition: 'transform .2s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
        Catálogo - escribe cantidad y precio, luego Enter ↵
        {items.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, background: 'var(--v)', color: '#fff', borderRadius: 20, padding: '1px 8px' }}>
            {items.length} ítem{items.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="psearch" style={{ marginBottom: 7 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gt)" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input ref={searchRef} type="text" placeholder="Filtrar catálogo..." value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button onClick={() => setSearch('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', fontSize: 18, color: 'var(--gt)', lineHeight: 1 }}>
                ×
              </button>
            )}
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', marginBottom: 12 }}>
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 120px 110px 32px', gap: 8,
              padding: '7px 12px', background: 'var(--b)', borderBottom: '2px solid var(--brd)',
              position: 'sticky', top: 0, zIndex: 2,
              fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.4px',
            }}>
              <div>Producto</div><div>Cantidad</div><div>Precio</div><div></div>
            </div>

            {visibleGroups.length === 0 && (
              <div style={{ padding: '12px 13px', fontSize: 13, color: 'var(--gt)' }}>Sin resultados para "{search}"</div>
            )}

            {visibleGroups.map(group => (
              <div key={group.category}>
                <div style={{
                  background: 'var(--bg)', color: 'var(--gt)', fontWeight: 800, fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                  padding: '7px 12px', borderBottom: '1px solid var(--brd)', borderTop: '1px solid var(--brd)',
                }}>
                  {group.category}
                </div>
                {group.products.map(p => {
                  const local = getLocal(p.name);
                  const isCommitted = items.some(i => i.product_name === p.name);
                  const hasLocal = !!(local.qty.trim() || local.price.trim());
                  return (
                    <div key={p.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 120px 110px 32px', gap: 8,
                      padding: '7px 12px', borderBottom: '1px solid var(--brd)', alignItems: 'center',
                      background: isCommitted ? 'var(--vc)' : 'var(--b)', transition: 'background .1s',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: isCommitted ? 700 : 400, color: isCommitted ? 'var(--vd)' : 'var(--n)' }}>
                        {p.name}
                        {isCommitted && <span style={{ marginLeft: 5, fontSize: 11, color: 'var(--v)' }}>✓</span>}
                      </div>
                      <input
                        className="iinput"
                        placeholder="Ej: 2 kg"
                        value={local.qty}
                        onChange={e => setLocal(p.name, 'qty', e.target.value)}
                        onKeyDown={e => handleKey(e, p.name)}
                        style={{ fontSize: 13 }}
                      />
                      <input
                        className="iinput"
                        placeholder="$0"
                        type="number"
                        value={local.price}
                        onChange={e => setLocal(p.name, 'price', e.target.value)}
                        onKeyDown={e => handleKey(e, p.name)}
                        style={{ fontSize: 13 }}
                      />
                      {/* Confirm button */}
                      <button
                        onClick={() => commitProduct(p.name)}
                        disabled={!hasLocal}
                        style={{
                          width: 26, height: 26, borderRadius: '50%', border: 'none',
                          background: hasLocal ? 'var(--v)' : 'var(--brd)',
                          color: hasLocal ? '#fff' : 'var(--gt)',
                          cursor: hasLocal ? 'pointer' : 'default',
                          fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, transition: 'all .15s',
                        }}
                        title="Agregar al pedido (o presiona Enter)"
                      >
                        ✓
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Factbox — committed items with × remove */}
      <div className="factbox">
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 9 }}>
          Resumen del pedido
        </div>
        {items.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--gt)', marginBottom: 8 }}>
            Filtra el catálogo, llena cantidad/precio y presiona Enter para agregar
          </div>
        )}
        {items.map(i => (
          <div key={i.product_name} className="factrow">
            <span>{i.product_name}{i.quantity_label && ` - ${i.quantity_label}`}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {parseFloat(i.price) ? `$${parseFloat(i.price).toLocaleString('es-CO')}` : '—'}
              <button
                onClick={() => removeItem(i.product_name)}
                title="Quitar del pedido"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#DC2626', fontSize: 16, lineHeight: 1, padding: '0 2px', fontWeight: 700,
                }}
              >×</button>
            </span>
          </div>
        ))}
        {items.length > 0 && (
          <div className="facttot">
            <span>Total</span>
            <span>${total.toLocaleString('es-CO')}</span>
          </div>
        )}
      </div>
    </>
  );
}
