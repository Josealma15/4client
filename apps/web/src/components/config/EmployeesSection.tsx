import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { ConfirmDialog } from './ConfirmDialog';

// ─── Employees ───────────────────────────────────────────────────────────────

export default function EmployeesSection() {
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
