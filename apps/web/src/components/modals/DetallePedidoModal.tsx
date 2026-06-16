import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { useProducts } from '../../hooks/useProducts';
import { useEmployees } from '../../hooks/useEmployees';
import { STATUS_LABEL, STATUS_ORDER, fmtCOP } from '../../lib/format';
import { toast } from '../ui/Toast';
import ProductSearch from '../orders/ProductSearch';

interface Props { orderId: string; onClose: () => void; }

const COD_COLORS: Record<string, string> = {
  nuevo: '#94A3B8', preparando: '#F59E0B', listo: '#3B82F6',
  camino: '#8B5CF6', entregado: '#1A7A4A', cerrado: '#0F4F30',
};

export default function DetallePedidoModal({ orderId, onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: employees = [] } = useEmployees();

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<{ data: any }>(`/orders/${orderId}`).then((r) => r.data),
  });

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [pago, setPago] = useState('cod');
  const [empleadoId, setEmpleadoId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showHist, setShowHist] = useState(false);
  const [showCobro, setShowCobro] = useState(false);
  const [cobroRec, setCobroRec] = useState('');

  useEffect(() => {
    if (!order) return;
    setNombre(order.customer_name ?? '');
    setTelefono(order.phone ?? '');
    setDireccion(order.address ?? '');
    setPago(order.payment_method ?? 'cod');
    setEmpleadoId(order.employee_id ?? '');
    setItems((order.items ?? []).map((i: any) => ({
      productId: i.product_id,
      name: i.product?.name ?? i.name ?? '',
      quantity_label: i.quantity_label ?? '',
      price: String(i.price ?? ''),
    })));
    setDirty(false);
  }, [order]);

  const saveMut = useMutation({
    mutationFn: () => api.patch(`/orders/${orderId}`, {
      customer_name: nombre, phone: telefono, address: direccion,
      payment_method: pago, employee_id: empleadoId || null,
      items: items.map((i) => ({ product_id: i.productId, quantity_label: i.quantity_label, price: parseFloat(i.price) || 0 })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['order', orderId] }); toast('Cambios guardados'); setDirty(false); },
    onError: (e: any) => toast(e.message, true),
  });

  const moveMut = useMutation({
    mutationFn: (status: string) => api.patch(`/orders/${orderId}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['order', orderId] }); toast('Estado actualizado'); },
    onError: (e: any) => toast(e.message, true),
  });

  const cobroMut = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/cobro`, {
      payment_method: pago,
      amount_received: parseFloat(cobroRec) || 0,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['order', orderId] }); toast('Pago confirmado'); setShowCobro(false); },
    onError: (e: any) => toast(e.message, true),
  });

  if (isLoading || !order) return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mwin"><div className="mbody" style={{ textAlign: 'center', color: 'var(--gt)' }}>Cargando...</div></div>
    </div>
  );

  const locked = order.locked;
  const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
  const devolucion = Math.max(0, (parseFloat(cobroRec) || 0) - total);

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mwin">
        <div className="mhead">
          <div>
            <div className="mtit">Pedido #{order.num}</div>
            <div className="msub">{order.customer_name}</div>
          </div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="mbody">
          {locked && (
            <div className="locked-banner">🔒 Pedido cobrado y cerrado. Solo el admin puede ver el historial.</div>
          )}
          {!locked && (
            <>
              <div className="stit">Mover pedido</div>
              <div className="movbtns">
                {STATUS_ORDER.filter((s) => s !== 'cerrado').map((s) => (
                  <button key={s} className={`mbtn${order.status === s ? ' cur' : ''}`}
                    disabled={order.status === s || moveMut.isPending}
                    onClick={() => moveMut.mutate(s)}
                    style={{ borderLeftColor: COD_COLORS[s] }}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="stit">Información del pedido</div>
          <div className="frow">
            <div className="fg2">
              <label className="fl2">Nombre del cliente</label>
              <input className="fi2" disabled={locked} value={nombre}
                onChange={(e) => { setNombre(e.target.value); setDirty(true); }} />
            </div>
            <div className="fg2">
              <label className="fl2">Teléfono</label>
              <input className="fi2" disabled={locked} value={telefono}
                onChange={(e) => { setTelefono(e.target.value); setDirty(true); }} />
            </div>
          </div>
          <div className="fg2">
            <label className="fl2">Dirección</label>
            <input className="fi2" disabled={locked} value={direccion}
              onChange={(e) => { setDireccion(e.target.value); setDirty(true); }} />
          </div>
          <div className="frow">
            <div className="fg2">
              <label className="fl2">Método de pago</label>
              <select className="fi2" disabled={locked} value={pago}
                onChange={(e) => { setPago(e.target.value); setDirty(true); }}>
                <option value="cod">💵 Cobra en casa</option>
                <option value="transfer">📲 Transferencia</option>
                <option value="cash">💳 Pagado en tienda</option>
              </select>
            </div>
            <div className="fg2">
              <label className="fl2">Domiciliario</label>
              <select className="fi2" disabled={locked} value={empleadoId}
                onChange={(e) => { setEmpleadoId(e.target.value); setDirty(true); }}>
                <option value="">— Sin asignar —</option>
                {employees.map((emp: any) => (
                  <option key={emp.id} value={emp.id}>🛵 {emp.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="stit">Productos</div>
          <ProductSearch products={products} items={items} locked={locked}
            onChange={(it) => { setItems(it); setDirty(true); }} />

          {isAdmin && order.history && order.history.length > 0 && (
            <div>
              <div className={`hist-toggle${showHist ? ' open' : ''}`} onClick={() => setShowHist(!showHist)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                Historial de cambios
                <span style={{ background: 'var(--v)', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 800, marginLeft: 'auto' }}>
                  {order.history.length}
                </span>
              </div>
              {showHist && (
                <div className="hist-body open">
                  {order.history.map((h: any, i: number) => (
                    <div key={i} className="hitem">
                      <div className="hdot" />
                      <div>
                        <div className="hwho">{h.actor?.name ?? 'Sistema'}</div>
                        <div className="hwhat">{h.notes}</div>
                        <div className="hwhen">{new Date(h.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mactions">
            <button className="bsec" onClick={onClose}>Cerrar</button>
            {!locked && dirty && (
              <button className="bpri" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? 'Guardando...' : '💾 Guardar cambios'}
              </button>
            )}
            {!locked && isAdmin && order.status === 'entregado' && !order.paid && (
              <button className="bverde" onClick={() => setShowCobro(true)}>💵 Confirmar cobro</button>
            )}
          </div>
        </div>
      </div>

      {showCobro && (
        <div className="moverlay on" style={{ zIndex: 700 }}>
          <div className="cobrobox">
            <div style={{ fontSize: 24, textAlign: 'center', marginBottom: 12 }}>💵</div>
            <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}>¿Confirmar pago?</div>
            <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--gt)', marginBottom: 16 }}>
              {order.customer_name} · Total: {fmtCOP(total)}
            </div>
            <div style={{ background: 'var(--ac)', borderRadius: 'var(--rad)', padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--a)', fontWeight: 600, textAlign: 'center' }}>
              ⚠ Una vez confirmado, el pedido quedará bloqueado.
            </div>
            <div className="fg2">
              <label className="fl2">¿Cuánto entregó el domiciliario?</label>
              <input className="fi2" type="number" placeholder={`Ej: ${total}`} value={cobroRec}
                onChange={(e) => setCobroRec(e.target.value)} />
              <div style={{ fontSize: 13, color: 'var(--gt)', marginTop: 7, fontWeight: 600 }}>
                Devolución al cliente: <strong>{fmtCOP(devolucion)}</strong>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
              <button className="bsec" onClick={() => setShowCobro(false)}>Cancelar</button>
              <button className="bpri" onClick={() => cobroMut.mutate()} disabled={cobroMut.isPending}>
                {cobroMut.isPending ? 'Confirmando...' : '✅ Sí, confirmar pago'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
