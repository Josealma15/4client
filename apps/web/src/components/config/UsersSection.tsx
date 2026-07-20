import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, RotateCcw, X, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { useAuthStore } from '../../store/auth';
import { ConfirmDialog } from './ConfirmDialog';
import PasswordInput from '../ui/PasswordInput';

// ─── Users ───────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  encargado: 'Encargado',
  domiciliario: 'Domiciliario',
  dev: 'Dev',
};

export default function UsersSection() {
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
              <PasswordInput className="fi" value={form.password}
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
                    <PasswordInput
                      className="fi"
                      value={newPass}
                      onChange={e => setNewPass(e.target.value)}
                      placeholder="Nueva contraseña (mín. 6 caracteres)"
                      wrapperStyle={{ flex: 1 }}
                      style={{ padding: '9px 12px', fontSize: 13 }}
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
