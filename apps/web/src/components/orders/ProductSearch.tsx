import { useState, useRef, useEffect } from 'react';

interface Product { id: string; name: string; category: string; }
interface Item { productId: string; name: string; quantity_label: string; price: string; }

interface Props {
  products: Product[];
  items: Item[];
  locked?: boolean;
  onChange: (items: Item[]) => void;
}

export default function ProductSearch({ products, items, locked, onChange }: Props) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = search.length > 0
    ? products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 12)
    : [];

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function addProduct(p: Product) {
    if (items.find((i) => i.productId === p.id)) return;
    onChange([...items, { productId: p.id, name: p.name, quantity_label: '', price: '' }]);
    setSearch('');
    setOpen(false);
  }

  function updateItem(idx: number, field: 'quantity_label' | 'price', val: string) {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: val };
    onChange(next);
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  const total = items.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);

  return (
    <>
      <div className="psearch" ref={ref}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gt)" strokeWidth="2.5">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          placeholder={locked ? 'Pedido bloqueado' : 'Buscar producto...'}
          value={search}
          disabled={locked}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => search && setOpen(true)}
        />
        {open && filtered.length > 0 && (
          <div className="pdrop on" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50 }}>
            {filtered.map((p) => (
              <div key={p.id} className="popt" onMouseDown={() => addProduct(p)}>
                <span className="popt-n">{p.name}</span>
                <span className="popt-c">{p.category}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ilist">
        <div className="irow hdr">
          <div>Producto</div><div>Cantidad</div><div>Precio</div>
          {!locked && <div></div>}
        </div>
        {items.length === 0 && (
          <div style={{ padding: '12px 13px', fontSize: 13, color: 'var(--gt)' }}>
            Sin productos aún
          </div>
        )}
        {items.map((item, idx) => (
          <div key={item.productId} className={`irow${locked ? ' locked-row' : ''}`}>
            <div className="iname">{item.name}</div>
            <input className="iinput" placeholder="Ej: 2 kg" disabled={locked}
              value={item.quantity_label}
              onChange={(e) => updateItem(idx, 'quantity_label', e.target.value)} />
            <input className="iinput" placeholder="Precio" type="number" disabled={locked}
              value={item.price}
              onChange={(e) => updateItem(idx, 'price', e.target.value)} />
            {!locked && (
              <button className="idel" onClick={() => removeItem(idx)}>×</button>
            )}
          </div>
        ))}
      </div>

      <div className="factbox">
        {items.map((i) => (
          <div key={i.productId} className="factrow">
            <span>{i.name} {i.quantity_label && `(${i.quantity_label})`}</span>
            <span>${(parseFloat(i.price) || 0).toLocaleString('es-CO')}</span>
          </div>
        ))}
        <div className="facttot">
          <span>Total</span>
          <span>${total.toLocaleString('es-CO')}</span>
        </div>
      </div>
    </>
  );
}
