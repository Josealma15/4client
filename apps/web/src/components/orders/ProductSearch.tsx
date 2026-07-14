import { useState, useMemo, useEffect, useRef, KeyboardEvent } from 'react';
import { Check, Pencil, X } from 'lucide-react';

interface Product { id: string; name: string; category: string; }
interface Item { product_name: string; quantity_label: string; price: string; added_by_client?: boolean; }

interface Props {
  products: Product[];
  items: Item[];
  locked?: boolean;
  onChange: (items: Item[]) => void;
  onLocalDirty?: (dirty: boolean) => void;
  clearKey?: number;
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

export default function ProductSearch({ products, items, locked, onChange, onLocalDirty, clearKey }: Props) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const [localInputs, setLocalInputs] = useState<Record<string, { qty: string; price: string }>>({});
  // Which committed item (by product_name) is being edited inline in the Factbox
  // table below — editing never touches the catalog's collapsed state anymore, so
  // it stays collapsed by default the way the person left it.
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const editQtyRef = useRef<HTMLInputElement | null>(null);

  // Clear local inputs when parent signals a save (clearKey increments)
  useEffect(() => {
    if (clearKey == null) return;
    setLocalInputs({});
    onLocalDirty?.(false);
  }, [clearKey]);

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

    // Preserve provenance — staff editing qty/price on a line the client added
    // (typically filling in the price, which the client's form never sets) must not
    // silently clear the flag that marks it as a client-originated change.
    const priorItem = items.find(i => i.product_name === productName);
    const newItem: Item = {
      product_name: productName,
      quantity_label: local.qty.trim(),
      price: local.price.trim(),
      added_by_client: priorItem?.added_by_client ?? false,
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

    // Return focus to search bar so user can quickly find next product (a no-op if
    // the catalog is collapsed, e.g. when this commit came from an inline Factbox edit)
    setSearch('');
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

  function editItem(item: Item) {
    setLocalInputs(prev => ({ ...prev, [item.product_name]: { qty: item.quantity_label, price: item.price } }));
    onLocalDirty?.(true);
    setEditingRow(item.product_name);
  }

  function cancelEdit(productName: string) {
    setLocalInputs(prev => {
      const copy = { ...prev };
      delete copy[productName];
      return copy;
    });
    setEditingRow(null);
  }

  function saveEdit(productName: string) {
    commitProduct(productName);
    setEditingRow(null);
  }

  useEffect(() => {
    if (!editingRow) return;
    editQtyRef.current?.focus();
    editQtyRef.current?.select();
  }, [editingRow]);

  const total = items.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);

  // Locked mode: read-only table
  if (locked) {
    return (
      <div style={{ border: '1px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden', marginBottom: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>Producto</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)', whiteSpace: 'nowrap' }}>Cantidad</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)' }}>Precio</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={3} style={{ padding: '12px', color: 'var(--gt)', textAlign: 'center' }}>Sin productos</td></tr>
            )}
            {items.map((i, idx) => (
              <tr key={i.product_name} style={{ background: idx % 2 === 0 ? 'var(--b)' : 'var(--bg)' }}>
                <td style={{ padding: '9px 12px', fontWeight: 600, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)', color: i.added_by_client ? '#DC2626' : undefined }}>
                  {i.product_name}
                  {i.added_by_client && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#DC2626' }}>· cliente</span>}
                </td>
                <td style={{ padding: '9px 12px', textAlign: 'center', color: i.added_by_client ? '#DC2626' : 'var(--vd)', fontWeight: 700, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>{i.quantity_label || '—'}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, borderBottom: '1px solid var(--brd)', color: i.added_by_client ? '#DC2626' : undefined }}>{parseFloat(i.price) ? `$${parseFloat(i.price).toLocaleString('es-CO')}` : '—'}</td>
              </tr>
            ))}
            {items.length > 0 && (
              <tr style={{ background: 'var(--vc)' }}>
                <td colSpan={2} style={{ padding: '9px 12px', fontWeight: 800, color: 'var(--vd)', borderRight: '1px solid var(--brd)' }}>Total</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--vd)', fontSize: 14 }}>${total.toLocaleString('es-CO')}</td>
              </tr>
            )}
          </tbody>
        </table>
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
        Catálogo - escribe cantidad y precio
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
                        {isCommitted && <Check size={11} color="var(--v)" style={{ marginLeft: 5, display: 'inline', verticalAlign: 'middle' }} />}
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
                        <Check size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Factbox — committed items table with edit/remove */}
      <div style={{ border: '1px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden', marginBottom: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>Producto</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)', whiteSpace: 'nowrap' }}>Cantidad</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 800, color: 'var(--gt)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>Precio</th>
              <th style={{ padding: '8px 6px', borderBottom: '2px solid var(--brd)', width: 52 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '12px', color: 'var(--gt)', textAlign: 'center', fontSize: 12 }}>
                Filtra el catálogo, llena cantidad/precio y presiona Enter para agregar
              </td></tr>
            )}
            {items.map((i, idx) => {
              const isEditing = editingRow === i.product_name;
              const local = getLocal(i.product_name);
              return (
                <tr key={i.product_name} style={{ background: idx % 2 === 0 ? 'var(--b)' : 'var(--bg)' }}>
                  <td style={{ padding: '9px 12px', fontWeight: 600, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)', color: i.added_by_client ? '#DC2626' : undefined }}>
                    {i.product_name}
                    {i.added_by_client && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#DC2626' }}>· cliente</span>}
                  </td>
                  <td style={{ padding: isEditing ? '5px 8px' : '9px 12px', textAlign: 'center', color: i.added_by_client ? '#DC2626' : 'var(--vd)', fontWeight: 700, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)' }}>
                    {isEditing ? (
                      <input
                        ref={editQtyRef}
                        className="iinput"
                        placeholder="Ej: 2 kg"
                        value={local.qty}
                        onChange={e => setLocal(i.product_name, 'qty', e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); saveEdit(i.product_name); }
                          if (e.key === 'Escape') { e.preventDefault(); cancelEdit(i.product_name); }
                        }}
                        style={{ fontSize: 13, width: '100%', textAlign: 'center' }}
                      />
                    ) : (i.quantity_label || '—')}
                  </td>
                  <td style={{ padding: isEditing ? '5px 8px' : '9px 12px', textAlign: 'right', fontWeight: 700, borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)', color: !isEditing && i.added_by_client ? '#DC2626' : undefined }}>
                    {isEditing ? (
                      <input
                        className="iinput"
                        placeholder="$0"
                        type="number"
                        value={local.price}
                        onChange={e => setLocal(i.product_name, 'price', e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); saveEdit(i.product_name); }
                          if (e.key === 'Escape') { e.preventDefault(); cancelEdit(i.product_name); }
                        }}
                        style={{ fontSize: 13, width: '100%', textAlign: 'right' }}
                      />
                    ) : (parseFloat(i.price) ? `$${parseFloat(i.price).toLocaleString('es-CO')}` : '—')}
                  </td>
                  <td style={{ padding: '6px', borderBottom: '1px solid var(--brd)', textAlign: 'center' }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(i.product_name)} title="Guardar (o Enter)"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v)', display: 'flex', alignItems: 'center', padding: 2 }}>
                            <Check size={13} />
                          </button>
                          <button onClick={() => cancelEdit(i.product_name)} title="Cancelar (o Esc)"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gt)', display: 'flex', alignItems: 'center', padding: 2 }}>
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => editItem(i)} title="Editar"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--az)', display: 'flex', alignItems: 'center', padding: 2 }}>
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => removeItem(i.product_name)} title="Quitar"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', display: 'flex', alignItems: 'center', padding: 2, fontSize: 15, fontWeight: 700, lineHeight: 1 }}>
                            ×
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {items.length > 0 && (
              <tr style={{ background: 'var(--vc)' }}>
                <td colSpan={2} style={{ padding: '9px 12px', fontWeight: 800, color: 'var(--vd)', borderRight: '1px solid var(--brd)' }}>Total</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--vd)', fontSize: 14 }}>${total.toLocaleString('es-CO')}</td>
                <td style={{ borderLeft: '1px solid var(--brd)' }}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
