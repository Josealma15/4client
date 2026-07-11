import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { ConfirmDialog } from './ConfirmDialog';

// ─── Products ────────────────────────────────────────────────────────────────

interface ProductForm {
  name: string;
  category: string;
  newCategory: string;
  useNewCategory: boolean;
  price_per_unit: string;
  unit_type: string;
}

export default function ProductsSection() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ProductForm | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.get<{ data: any[] }>('/products').then((r) => r.data),
    staleTime: 0,
  });

  // Derive unique categories from existing products
  const existingCategories: string[] = Array.from(
    new Set((products as any[]).map((p: any) => p.category).filter(Boolean))
  ).sort() as string[];

  const save = useMutation({
    mutationFn: (body: any) =>
      editId
        ? api.patch(`/products/${editId}`, body)
        : api.post('/products', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      setForm(null);
      setEditId(null);
      toast(editId ? 'Producto actualizado' : 'Producto creado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      setConfirmDelete(null);
      toast('Producto desactivado');
    },
    onError: (e: any) => { setConfirmDelete(null); toast(e.message, true); },
  });

  function openCreate() {
    setEditId(null);
    setForm({ name: '', category: existingCategories[0] ?? '', newCategory: '', useNewCategory: existingCategories.length === 0, price_per_unit: '', unit_type: 'kg' });
  }

  function openEdit(p: any) {
    setEditId(p.id);
    const catExists = existingCategories.includes(p.category ?? '');
    setForm({
      name: p.name,
      category: catExists ? (p.category ?? '') : '',
      newCategory: catExists ? '' : (p.category ?? ''),
      useNewCategory: !catExists && !!p.category,
      price_per_unit: p.price_per_unit != null ? String(p.price_per_unit) : '',
      unit_type: p.unit_type ?? 'kg',
    });
  }

  function resolvedCategory(f: ProductForm): string {
    return f.useNewCategory ? f.newCategory.trim() : f.category;
  }

  function handleSubmit() {
    if (!form?.name.trim()) return toast('El nombre es obligatorio', true);
    const category = resolvedCategory(form);
    const price = parseFloat(form.price_per_unit);
    save.mutate({
      name: form.name.trim(),
      category: category || undefined,
      price_per_unit: !isNaN(price) && price > 0 ? price : undefined,
      unit_type: form.unit_type.trim() || undefined,
    });
  }

  function toggleCat(cat: string) {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  // Group by category
  const grouped = (products as any[]).reduce((acc: Record<string, any[]>, p: any) => {
    const cat = p.category || 'Sin categoría';
    acc[cat] = [...(acc[cat] ?? []), p];
    return acc;
  }, {});

  return (
    <div>
      {confirmDelete && (
        <ConfirmDialog
          message={`¿Desactivar "${confirmDelete.name}"? El producto dejará de aparecer para nuevos pedidos. Los pedidos existentes que lo contienen no se ven afectados porque el nombre ya está guardado en cada pedido.`}
          onConfirm={() => del.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <span style={{ fontSize: 13, color: 'var(--gt)' }}>{(products as any[]).length} productos activos</span>
        <button className="bnew" onClick={openCreate}><Plus size={14} /> Nuevo producto</button>
      </div>

      {form !== null && (
        <div style={{ background: 'var(--vc)', border: '2px solid var(--v)', borderRadius: 'var(--rad)', padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 14, color: 'var(--vd)' }}>
            {editId ? 'Editar producto' : 'Nuevo producto'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="fl">Nombre *</label>
              <input className="fi" value={form.name}
                onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))}
                placeholder="Ej: Papa pastusa"
                autoFocus />
            </div>
            <div>
              <label className="fl">Categoría</label>
              {!form.useNewCategory ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select className="fi" style={{ flex: 1 }} value={form.category}
                    onChange={e => setForm(f => f && ({ ...f, category: e.target.value }))}>
                    {existingCategories.length === 0 && <option value="">Sin categoría</option>}
                    {existingCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button type="button" className="bverde" style={{ padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                    onClick={() => setForm(f => f && ({ ...f, useNewCategory: true, newCategory: '' }))}>
                    + Nueva
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="fi" style={{ flex: 1 }} value={form.newCategory}
                    onChange={e => setForm(f => f && ({ ...f, newCategory: e.target.value }))}
                    placeholder="Nombre de la nueva categoría" />
                  {existingCategories.length > 0 && (
                    <button type="button" className="bsec" style={{ padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                      onClick={() => setForm(f => f && ({ ...f, useNewCategory: false, newCategory: '' }))}>
                      Existente
                    </button>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="fl">Precio ref. por unidad</label>
              <input className="fi" type="number" min="0" value={form.price_per_unit}
                onChange={e => setForm(f => f && ({ ...f, price_per_unit: e.target.value }))}
                placeholder="Ej: 3500" />
            </div>
            <div>
              <label className="fl">Unidad</label>
              <select className="fi" value={form.unit_type}
                onChange={e => setForm(f => f && ({ ...f, unit_type: e.target.value }))}>
                <option value="kg">kg</option>
                <option value="unidad">Unidad</option>
                <option value="libra">Libra</option>
                <option value="bulto">Bulto</option>
                <option value="caja">Caja</option>
                <option value="canasta">Canasta</option>
                <option value="manojo">Manojo</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="bpri" style={{ flex: 0, padding: '10px 22px', margin: 0 }}
              onClick={handleSubmit} disabled={save.isPending}>
              <Check size={14} /> {save.isPending ? 'Guardando...' : 'Guardar'}
            </button>
            <button className="bsec" style={{ flex: 0, padding: '10px 18px' }}
              onClick={() => { setForm(null); setEditId(null); }}>
              <X size={14} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--gt)', padding: 24 }}>Cargando...</div>
      ) : (products as any[]).length === 0 ? (
        <div style={{ color: 'var(--gt)', fontSize: 14, padding: 16 }}>No hay productos. Crea el primero.</div>
      ) : (
        Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, prods]) => {
          const collapsed = !expandedCats.has(cat);
          return (
            <div key={cat} style={{ marginBottom: 12, border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden' }}>
              {/* Category header — clickable to collapse */}
              <button
                onClick={() => toggleCat(cat)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--gm)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                {collapsed ? <ChevronRight size={15} color="var(--gt)" /> : <ChevronDown size={15} color="var(--gt)" />}
                <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--gt)', flex: 1 }}>{cat}</span>
                <span style={{ fontSize: 11, color: 'var(--gt)', fontWeight: 600 }}>{(prods as any[]).length} productos</span>
              </button>
              {!collapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {(prods as any[]).map((p: any) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', background: 'var(--b)', padding: '10px 14px', gap: 10, borderTop: '1px solid var(--brd)' }}>
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                      {p.price_per_unit != null && (
                        <span style={{ fontSize: 12, color: 'var(--vd)', fontWeight: 700, background: 'var(--vc)', padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap' }}>
                          ${Number(p.price_per_unit).toLocaleString('es-CO')}/{p.unit_type ?? 'kg'}
                        </span>
                      )}
                      <button className="dc-btn" title="Editar" onClick={() => openEdit(p)}>
                        <Pencil size={13} />
                      </button>
                      <button className="dc-btn" title="Desactivar"
                        onClick={() => setConfirmDelete({ id: p.id, name: p.name })}
                        style={{ borderColor: 'var(--r)', color: 'var(--r)' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
