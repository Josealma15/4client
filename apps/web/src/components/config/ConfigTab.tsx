import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, RotateCcw, X, Check, Package, Truck, Users, ChevronDown, ChevronRight, AlertTriangle, Code2, Database, MessageSquare, Settings, ExternalLink, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { useAuthStore } from '../../store/auth';

type Section = 'productos' | 'domiciliarios' | 'usuarios' | 'dev';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  encargado: 'Encargado',
  domiciliario: 'Domiciliario',
  dev: 'Dev',
};

// ─── Simple confirmation dialog ───────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--b)', borderRadius: 'var(--rad)', padding: 28, maxWidth: 400, width: '100%', boxShadow: 'var(--shf)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 20 }}>
          <AlertTriangle size={22} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--n)' }}>{message}</p>
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button className="bdel" style={{ flex: 1 }} onClick={onConfirm}>Confirmar</button>
          <button className="bsec" style={{ flex: 1 }} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Products ────────────────────────────────────────────────────────────────

interface ProductForm {
  name: string;
  category: string;
  newCategory: string;
  useNewCategory: boolean;
}

function ProductsSection() {
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
    setForm({ name: '', category: existingCategories[0] ?? '', newCategory: '', useNewCategory: existingCategories.length === 0 });
  }

  function openEdit(p: any) {
    setEditId(p.id);
    const catExists = existingCategories.includes(p.category ?? '');
    setForm({
      name: p.name,
      category: catExists ? (p.category ?? '') : '',
      newCategory: catExists ? '' : (p.category ?? ''),
      useNewCategory: !catExists && !!p.category,
    });
  }

  function resolvedCategory(f: ProductForm): string {
    return f.useNewCategory ? f.newCategory.trim() : f.category;
  }

  function handleSubmit() {
    if (!form?.name.trim()) return toast('El nombre es obligatorio', true);
    const category = resolvedCategory(form);
    save.mutate({ name: form.name.trim(), category: category || undefined });
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

// ─── Employees ───────────────────────────────────────────────────────────────

function EmployeesSection() {
  const qc = useQueryClient();
  const [form, setForm] = useState<{ name: string; phone: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get<{ data: any[] }>('/employees').then((r) => r.data),
    staleTime: 0,
  });

  const save = useMutation({
    mutationFn: (body: any) =>
      editId
        ? api.patch(`/employees/${editId}`, body)
        : api.post('/employees', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setForm(null);
      setEditId(null);
      toast(editId ? 'Domiciliario actualizado' : 'Domiciliario creado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  // Use DELETE endpoint (soft-deletes via active: false)
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/employees/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setConfirmDelete(null);
      toast('Domiciliario desactivado');
    },
    onError: (e: any) => { setConfirmDelete(null); toast(e.message, true); },
  });

  function openCreate() { setEditId(null); setForm({ name: '', phone: '' }); }
  function openEdit(e: any) { setEditId(e.id); setForm({ name: e.name, phone: e.phone ?? '' }); }
  function handleSubmit() {
    if (!form?.name.trim()) return toast('El nombre es obligatorio', true);
    save.mutate({ name: form.name.trim(), phone: form.phone.trim() || undefined });
  }

  return (
    <div>
      {confirmDelete && (
        <ConfirmDialog
          message={`¿Desactivar a "${confirmDelete.name}"? Ya no aparecerá en la lista de domiciliarios para nuevos pedidos.`}
          onConfirm={() => del.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <span style={{ fontSize: 13, color: 'var(--gt)' }}>{(employees as any[]).length} domiciliarios activos</span>
        <button className="bnew" onClick={openCreate}><Plus size={14} /> Nuevo domiciliario</button>
      </div>

      {form !== null && (
        <div style={{ background: 'var(--vc)', border: '2px solid var(--v)', borderRadius: 'var(--rad)', padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 14, color: 'var(--vd)' }}>
            {editId ? 'Editar domiciliario' : 'Nuevo domiciliario'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="fl">Nombre *</label>
              <input className="fi" value={form.name}
                onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))}
                placeholder="Nombre completo" autoFocus />
            </div>
            <div>
              <label className="fl">Teléfono</label>
              <input className="fi" value={form.phone}
                onChange={e => setForm(f => f && ({ ...f, phone: e.target.value }))}
                placeholder="3001234567" />
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
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(employees as any[]).length === 0 && (
            <div style={{ color: 'var(--gt)', fontSize: 14, padding: 16 }}>No hay domiciliarios registrados.</div>
          )}
          {(employees as any[]).map((emp: any) => (
            <div key={emp.id} style={{ display: 'flex', alignItems: 'center', background: 'var(--b)', border: '1.5px solid var(--brd)', borderRadius: 10, padding: '12px 14px', gap: 10 }}>
              <div style={{ width: 36, height: 36, background: 'var(--az)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                {emp.name[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.name}</div>
                {emp.phone && <div style={{ fontSize: 12, color: 'var(--gt)' }}>{emp.phone}</div>}
              </div>
              <button className="dc-btn" title="Editar" onClick={() => openEdit(emp)}>
                <Pencil size={13} />
              </button>
              <button className="dc-btn" title="Desactivar"
                onClick={() => setConfirmDelete({ id: emp.id, name: emp.name })}
                style={{ borderColor: 'var(--r)', color: 'var(--r)' }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Users ───────────────────────────────────────────────────────────────────

function UsersSection() {
  const currentUser = useAuthStore(s => s.user);
  const canAssignDev = currentUser?.role === 'dev';
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '' });
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'encargado' as string });
  const [newPass, setNewPass] = useState('');
  const [confirmToggle, setConfirmToggle] = useState<{ id: string; name: string; active: boolean } | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users-admin'],
    queryFn: () => api.get<{ data: any[] }>('/users').then((r) => r.data),
    staleTime: 0,
  });

  const create = useMutation({
    mutationFn: (body: any) => api.post('/users', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-admin'] });
      setShowCreate(false);
      setForm({ name: '', email: '', password: '', role: 'encargado' });
      toast('Usuario creado exitosamente');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/users/${id}`, { active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-admin'] });
      setConfirmToggle(null);
      toast('Usuario actualizado');
    },
    onError: (e: any) => { setConfirmToggle(null); toast(e.message, true); },
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; email: string; role: string }) =>
      api.patch(`/users/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-admin'] });
      setEditId(null);
      toast('Usuario actualizado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const resetPass = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.post(`/users/${id}/reset-password`, { password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-admin'] });
      setResetId(null);
      setNewPass('');
      toast('Contraseña actualizada correctamente');
    },
    onError: (e: any) => toast(e.message, true),
  });

  function handleCreate() {
    if (!form.name.trim()) return toast('El nombre es obligatorio', true);
    if (!form.email.trim()) return toast('El correo es obligatorio', true);
    if (!form.password) return toast('La contraseña es obligatoria', true);
    if (form.password.length < 6) return toast('La contraseña debe tener al menos 6 caracteres', true);
    create.mutate({ name: form.name.trim(), email: form.email.trim().toLowerCase(), password: form.password, role: form.role });
  }

  function openEdit(u: any) {
    setEditId(u.id);
    setEditForm({ name: u.name, email: u.email, role: u.role });
    setResetId(null);
  }

  function handleUpdate() {
    if (!editForm.name.trim()) return toast('El nombre es obligatorio', true);
    if (!editForm.email.trim()) return toast('El correo es obligatorio', true);
    update.mutate({ id: editId!, name: editForm.name.trim(), email: editForm.email.trim(), role: editForm.role });
  }

  return (
    <div>
      {confirmToggle && (
        <ConfirmDialog
          message={confirmToggle.active
            ? `¿Desactivar a "${confirmToggle.name}"? No podrá iniciar sesión hasta que se reactive.`
            : `¿Reactivar a "${confirmToggle.name}"? Podrá volver a iniciar sesión.`}
          onConfirm={() => toggle.mutate({ id: confirmToggle.id, active: !confirmToggle.active })}
          onCancel={() => setConfirmToggle(null)}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <span style={{ fontSize: 13, color: 'var(--gt)' }}>{(users as any[]).length} usuarios en la organización</span>
        <button className="bnew" onClick={() => { setShowCreate(true); setResetId(null); }}>
          <Plus size={14} /> Nuevo usuario
        </button>
      </div>

      {showCreate && (
        <div style={{ background: 'var(--vc)', border: '2px solid var(--v)', borderRadius: 'var(--rad)', padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 14, color: 'var(--vd)' }}>Crear usuario</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="fl">Nombre *</label>
              <input className="fi" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Nombre completo" autoFocus />
            </div>
            <div>
              <label className="fl">Correo electrónico *</label>
              <input className="fi" type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="correo@empresa.com" />
            </div>
            <div>
              <label className="fl">Contraseña (mín. 6 caracteres) *</label>
              <input className="fi" type="password" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••" />
            </div>
            <div>
              <label className="fl">Rol *</label>
              <select className="fi" value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="encargado">Encargado</option>
                <option value="domiciliario">Domiciliario</option>
                <option value="admin">Administrador</option>
                {canAssignDev && <option value="dev">Dev (super-admin)</option>}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="bpri" style={{ flex: 0, padding: '10px 22px', margin: 0 }}
              onClick={handleCreate} disabled={create.isPending}>
              <Check size={14} /> {create.isPending ? 'Creando...' : 'Crear usuario'}
            </button>
            <button className="bsec" style={{ flex: 0, padding: '10px 18px' }}
              onClick={() => setShowCreate(false)}>
              <X size={14} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--gt)', padding: 24 }}>Cargando...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(users as any[]).map((u: any) => (
            <div key={u.id} style={{ background: 'var(--b)', border: '1.5px solid var(--brd)', borderRadius: 10, padding: '14px', opacity: u.active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 38, height: 38, flexShrink: 0, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15,
                  background: u.role === 'admin' ? 'var(--vd)' : u.role === 'encargado' ? 'var(--v)' : 'var(--az)',
                }}>
                  {u.name[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: u.role === 'admin' ? 'var(--vc)' : 'var(--azc)',
                      color: u.role === 'admin' ? 'var(--vd)' : 'var(--az)',
                    }}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                    {!u.active && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--rc)', color: 'var(--r)' }}>
                        Inactivo
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gt)', marginTop: 2 }}>{u.email}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    className="dc-btn"
                    title="Editar usuario"
                    onClick={() => editId === u.id ? setEditId(null) : openEdit(u)}
                    style={{ borderColor: 'var(--v)', color: 'var(--v)' }}>
                    <Pencil size={13} />
                  </button>
                  <button
                    className="dc-btn"
                    title="Restablecer contraseña"
                    onClick={() => { setResetId(resetId === u.id ? null : u.id); setNewPass(''); setEditId(null); }}
                    style={{ borderColor: 'var(--az)', color: 'var(--az)' }}>
                    <RotateCcw size={13} />
                  </button>
                  <button
                    className="dc-btn"
                    title={u.active ? 'Desactivar usuario' : 'Reactivar usuario'}
                    onClick={() => setConfirmToggle({ id: u.id, name: u.name, active: u.active })}
                    style={u.active
                      ? { borderColor: 'var(--r)', color: 'var(--r)' }
                      : { borderColor: 'var(--v)', color: 'var(--v)' }}>
                    {u.active ? <Trash2 size={13} /> : <Check size={13} />}
                  </button>
                </div>
              </div>

              {/* Inline edit panel */}
              {editId === u.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1.5px solid var(--brd)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--v)', marginBottom: 10 }}>
                    Editar datos de {u.name}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label className="fl" style={{ fontSize: 11 }}>Nombre *</label>
                      <input className="fi" value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        style={{ padding: '8px 11px', fontSize: 13 }} autoFocus />
                    </div>
                    <div>
                      <label className="fl" style={{ fontSize: 11 }}>Correo *</label>
                      <input className="fi" type="email" value={editForm.email}
                        onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                        style={{ padding: '8px 11px', fontSize: 13 }} />
                    </div>
                    <div>
                      <label className="fl" style={{ fontSize: 11 }}>Rol *</label>
                      <select className="fi" value={editForm.role}
                        onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                        style={{ padding: '8px 11px', fontSize: 13 }}>
                        <option value="encargado">Encargado</option>
                        <option value="domiciliario">Domiciliario</option>
                        <option value="admin">Administrador</option>
                        {canAssignDev && <option value="dev">Dev (super-admin)</option>}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="bpri" style={{ flex: 0, padding: '8px 18px', margin: 0, fontSize: 13 }}
                      onClick={handleUpdate} disabled={update.isPending}>
                      <Check size={13} /> {update.isPending ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                    <button className="bsec" style={{ flex: 0, padding: '8px 14px', fontSize: 13 }}
                      onClick={() => setEditId(null)}>
                      <X size={13} /> Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Inline reset password panel */}
              {resetId === u.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1.5px solid var(--brd)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--az)', marginBottom: 8 }}>
                    Restablecer contraseña de {u.name}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="fi"
                      type="password"
                      value={newPass}
                      onChange={e => setNewPass(e.target.value)}
                      placeholder="Nueva contraseña (mín. 6 caracteres)"
                      style={{ flex: 1, padding: '9px 12px', fontSize: 13 }}
                      autoFocus
                    />
                    <button
                      className="bverde"
                      style={{ padding: '9px 16px', fontSize: 13, whiteSpace: 'nowrap' }}
                      onClick={() => {
                        if (newPass.length < 6) return toast('Mínimo 6 caracteres', true);
                        resetPass.mutate({ id: u.id, password: newPass });
                      }}
                      disabled={resetPass.isPending}>
                      {resetPass.isPending ? '...' : 'Actualizar'}
                    </button>
                    <button className="bsec" style={{ padding: '9px 12px', fontSize: 13, flex: 0 }}
                      onClick={() => { setResetId(null); setNewPass(''); }}>
                      <X size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DevTools sub-panels ──────────────────────────────────────────────────────

type DevTab = 'bd' | 'wpp' | 'sistema' | 'links';

const DEV_TABS: { key: DevTab; label: string; icon: React.ReactNode }[] = [
  { key: 'bd',      label: 'Base de datos', icon: <Database size={13} /> },
  { key: 'wpp',     label: 'WhatsApp',      icon: <MessageSquare size={13} /> },
  { key: 'sistema', label: 'Sistema',        icon: <Settings size={13} /> },
  { key: 'links',   label: 'Links',          icon: <ExternalLink size={13} /> },
];

const DB_TABLES = ['users', 'organizations', 'products', 'employees', 'orders', 'tickets', 'ticket_messages', 'order_history', 'daily_closes'];

function DevWppPanel() {
  const qc = useQueryClient();
  const { data: org, isLoading } = useQuery({
    queryKey: ['config-org'],
    queryFn: () => api.get<{ data: any }>('/config/org').then(r => r.data),
  });

  const [phoneId, setPhoneId] = useState('');
  const [token, setToken] = useState('');
  const [welcome, setWelcome] = useState('');
  const [loaded, setLoaded] = useState(false);

  if (!loaded && org) {
    setPhoneId(org.wpp_meta_phone_id ?? '');
    setWelcome(org.welcome_message ?? '');
    setLoaded(true);
  }

  const save = useMutation({
    mutationFn: (data: any) => api.patch('/config/wpp', data),
    onSuccess: () => { toast('Config WPP guardada'); qc.invalidateQueries({ queryKey: ['config-org'] }); },
    onError: () => toast('Error al guardar', true),
  });

  function handleSave() {
    const data: any = { welcome_message: welcome || null };
    if (phoneId.trim()) data.wpp_meta_phone_id = phoneId.trim();
    if (token.trim()) data.wpp_meta_token = token.trim();
    save.mutate(data);
  }

  if (isLoading) return <div style={{ padding: 24, color: 'var(--gt)' }}>Cargando...</div>;

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gt)', marginBottom: 6 }}>Phone Number ID</div>
          <input
            style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--brd)', borderRadius: 8, fontSize: 14, background: 'var(--bg)', color: 'var(--n)', fontFamily: 'monospace' }}
            value={phoneId} onChange={e => setPhoneId(e.target.value)}
            placeholder={org?.wpp_meta_phone_id ? '(configurado)' : 'ej: 1162357783628740'}
          />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gt)', marginBottom: 6 }}>Access Token</div>
          <input
            type="password"
            style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--brd)', borderRadius: 8, fontSize: 14, background: 'var(--bg)', color: 'var(--n)', fontFamily: 'monospace' }}
            value={token} onChange={e => setToken(e.target.value)}
            placeholder="Dejar vacío para no cambiar"
          />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gt)', marginBottom: 4 }}>Mensaje de bienvenida</div>
          <div style={{ fontSize: 12, color: 'var(--gt)', marginBottom: 8 }}>Se envía al primer mensaje del día de cada cliente. Vacío = desactivado.</div>
          <textarea
            style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--brd)', borderRadius: 8, fontSize: 14, background: 'var(--bg)', color: 'var(--n)', minHeight: 90, resize: 'vertical' }}
            value={welcome} onChange={e => setWelcome(e.target.value)}
            placeholder="ej: Hola 👋 Bienvenido a Fruver San Gabriel. En un momento serás atendido por nuestro personal."
          />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="bpri" onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <div style={{ fontSize: 12, color: org?.wpp_meta_phone_id ? 'var(--v)' : 'var(--gt)' }}>
            {org?.wpp_meta_phone_id
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={13} color="var(--v)" /> Phone ID configurado</span>
            : <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={13} color="var(--r)" /> Sin configurar</span>}
          </div>
        </div>
      </div>
    </div>
  );
}


function DevDbPanel() {
  const [table, setTable] = useState('users');
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const limit = 20;

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['dev-db', table, offset],
    queryFn: () => api.get<{ data: any[]; total: number }>(`/dev/db?table=${table}&limit=${limit}&offset=${offset}`).then(r => r),
    staleTime: 0,
  });

  const allRows: any[] = (data as any)?.data ?? [];
  const rows = search
    ? allRows.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
    : allRows;
  const total: number = (data as any)?.total ?? 0;
  const cols = allRows.length > 0 ? Object.keys(allRows[0]) : [];
  const SECRET_COLS = new Set(['password_hash', 'token_hash', 'wpp_meta_token', 'wpp_meta_app_secret']);

  function fmtVal(col: string, val: any): string {
    if (val === null || val === undefined) return '—';
    if (SECRET_COLS.has(col)) return '••••••••';
    if (typeof val === 'boolean') return val ? '✓' : '✗';
    const s = String(val);
    return s.length > 60 ? s.slice(0, 57) + '...' : s;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="fi"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
          value={table}
          onChange={e => { setTable(e.target.value); setOffset(0); setSearch(''); }}>
          {DB_TABLES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          className="fi"
          style={{ width: 180, padding: '7px 12px', fontSize: 13 }}
          placeholder="Filtrar filas..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="bsec" style={{ padding: '7px 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }} onClick={() => refetch()}>
          <RotateCcw size={12} />{isFetching ? 'Cargando...' : 'Refrescar'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--gt)' }}>
          {search ? `${rows.length} de ${allRows.length} filas (${total} total)` : `${total} filas totales`}
        </span>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--gt)', padding: 16 }}>Cargando...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--gt)', padding: 16, fontSize: 13 }}>Sin datos en esta tabla.</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--brd)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
            <thead>
              <tr style={{ background: 'var(--gm)' }}>
                {cols.map(c => (
                  <th key={c} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--gt)', borderBottom: '1px solid var(--brd)', whiteSpace: 'nowrap' }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--brd)', background: i % 2 === 0 ? 'var(--b)' : 'var(--bg)' }}>
                  {cols.map(c => {
                    const display = fmtVal(c, row[c]);
                    const isSecret = SECRET_COLS.has(c);
                    return (
                      <td
                        key={c}
                        title={isSecret ? '(oculto)' : String(row[c] ?? '')}
                        style={{ padding: '7px 12px', color: isSecret ? 'var(--gt)' : 'var(--n)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button className="bsec" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
          disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} /> Anterior
        </button>
        <span style={{ fontSize: 12, color: 'var(--gt)' }}>
          {rows.length > 0 ? `${offset + 1}–${offset + rows.length} de ${total}` : '0 resultados'}
        </span>
        <button className="bsec" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
          disabled={rows.length < limit} onClick={() => setOffset(offset + limit)}>
          Siguiente <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

function DevSistemaPanel() {
  const { data: org } = useQuery({
    queryKey: ['config-org'],
    queryFn: () => api.get<{ data: any }>('/config/org').then(r => r.data),
  });

  const { data: health, refetch: pingHealth, isFetching: pinging } = useQuery({
    queryKey: ['dev-health'],
    queryFn: () => api.get<any>('/dev/health').then(r => r),
    enabled: false,
  });

  const { data: envStatus, refetch: fetchEnv, isFetching: loadingEnv } = useQuery({
    queryKey: ['dev-env-status'],
    queryFn: () => api.get<{ data: any }>('/dev/env-status').then(r => r.data),
    enabled: false,
  });

  const h = health as any;
  const env = envStatus as any;

  const envRows = env ? [
    { k: 'NODE_ENV',                  v: env.NODE_ENV,                  sensitive: false },
    { k: 'PORT',                      v: String(env.PORT),               sensitive: false },
    { k: 'META_WEBHOOK_VERIFY_TOKEN', v: env.META_WEBHOOK_VERIFY_TOKEN,  sensitive: true },
    { k: 'META_PHONE_NUMBER_ID',      v: env.META_PHONE_NUMBER_ID,       sensitive: true },
    { k: 'META_ACCESS_TOKEN',         v: env.META_ACCESS_TOKEN,          sensitive: true },
    { k: 'META_APP_SECRET',           v: env.META_APP_SECRET,            sensitive: true },
    { k: 'R2_ACCOUNT_ID',             v: env.R2_ACCOUNT_ID,              sensitive: true },
    { k: 'R2_ACCESS_KEY_ID',          v: env.R2_ACCESS_KEY_ID,           sensitive: true },
    { k: 'R2_SECRET_ACCESS_KEY',      v: env.R2_SECRET_ACCESS_KEY,       sensitive: true },
    { k: 'R2_BUCKET_NAME',            v: env.R2_BUCKET_NAME,             sensitive: true },
    { k: 'R2_PUBLIC_URL',             v: env.R2_PUBLIC_URL,              sensitive: true },
    { k: 'SENTRY_DSN',               v: env.SENTRY_DSN,                 sensitive: true },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Org card */}
        <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Org actual</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['ID', org?.id],
              ['Slug', org?.slug],
              ['Plan', org?.plan],
              ['WPP', org?.wpp_meta_phone_id ? 'configurado' : 'sin config'],
              ['Bienvenida', org?.welcome_message ? '✅ activa' : '—'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--gt)', minWidth: 80, flexShrink: 0 }}>{label}</span>
                <span style={{ color: 'var(--n)', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 11 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* API Health card */}
        <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: 1 }}>API Health</div>
            <button className="bsec" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => pingHealth()} disabled={pinging}>
              {pinging ? 'Cargando...' : 'Ping'}
            </button>
          </div>
          {h ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                ['Status', h.status],
                ['DB latency', `${h.db_latency_ms} ms`],
                ['Orgs', h.counts?.organizations],
                ['Users', h.counts?.users],
                ['Node', h.node_version],
                ['Uptime', `${Math.floor(h.uptime_s / 60)}m ${h.uptime_s % 60}s`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--gt)', minWidth: 80, flexShrink: 0 }}>{label}</span>
                  <span style={{ color: 'var(--n)', fontFamily: 'monospace', fontSize: 11 }}>{String(value ?? '—')}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--gt)' }}>Clic en Ping para verificar.</div>
          )}
        </div>
      </div>

      {/* Env vars status card */}
      <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: 1 }}>Variables de entorno</div>
          <button className="bsec" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => fetchEnv()} disabled={loadingEnv}>
            {loadingEnv ? 'Cargando...' : 'Cargar'}
          </button>
        </div>
        {env ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
            {envRows.map(({ k, v, sensitive }) => (
              <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'center' }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: sensitive
                    ? (v === true ? 'var(--v)' : 'var(--r)')
                    : 'var(--az)',
                }} />
                <span style={{ color: 'var(--gt)', fontFamily: 'monospace', fontSize: 11, flex: 1 }}>{k}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontFamily: 'monospace', color: sensitive ? (v === true ? 'var(--v)' : 'var(--r)') : 'var(--az)' }}>
                  {sensitive
                    ? v === true
                      ? <><CheckCircle size={11} color="var(--v)" /> set</>
                      : <><XCircle size={11} color="var(--r)" /> missing</>
                    : v}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--gt)' }}>Clic en Cargar para ver estado de vars de entorno.</div>
        )}
      </div>
    </div>
  );
}

function DevLinksPanel() {
  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gt)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Links rápidos</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { label: 'Railway (backend + BD)', url: 'https://railway.app' },
            { label: 'Vercel (frontend)', url: 'https://vercel.com' },
            { label: 'Sentry (errores)', url: 'https://sentry.io' },
            { label: 'Meta Business (WPP)', url: 'https://business.facebook.com' },
            { label: 'Cloudflare (DNS)', url: 'https://cloudflare.com' },
            { label: 'Prisma Studio (local)', url: 'http://localhost:5555' },
          ].map(({ label, url }) => (
            <a key={label} href={url} target="_blank" rel="noreferrer"
              style={{ fontSize: 13, color: 'var(--v)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--gt)' }}>→</span> {label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function DevSection() {
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

// ─── ConfigTab root ───────────────────────────────────────────────────────────

export default function ConfigTab() {
  const user = useAuthStore(s => s.user);
  const isDev = user?.role === 'dev';
  const [section, setSection] = useState<Section>(isDev ? 'dev' : 'productos');

  const tabs: { key: Section; label: string; icon: React.ReactNode }[] = isDev
    ? [{ key: 'dev', label: 'DevTools', icon: <Code2 size={15} /> }]
    : [
        { key: 'productos',     label: 'Productos',     icon: <Package size={15} /> },
        { key: 'domiciliarios', label: 'Domiciliarios', icon: <Truck size={15} /> },
        { key: 'usuarios',      label: 'Usuarios',      icon: <Users size={15} /> },
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

      {section === 'productos'     && !isDev && <ProductsSection />}
      {section === 'domiciliarios' && !isDev && <EmployeesSection />}
      {section === 'usuarios'      && !isDev && <UsersSection />}

      {section === 'dev'           &&  isDev && <DevSection />}
    </div>
  );
}
