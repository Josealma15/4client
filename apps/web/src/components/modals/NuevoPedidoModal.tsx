import { useState } from 'react';
import { Smartphone, Check } from 'lucide-react';
import { useProducts } from '../../hooks/useProducts';
import { useEmployees } from '../../hooks/useEmployees';
import { useCreateOrder } from '../../hooks/useOrders';
import { toast } from '../ui/Toast';
import ProductSearch from '../orders/ProductSearch';

interface Props {
  fecha: string;
  onClose: () => void;
  ticketId?: string;
  preNombre?: string;
  prePhone?: string;
  messages?: { text: string; direction: string; created_at?: string }[];
}

export default function NuevoPedidoModal({ fecha, onClose, ticketId, preNombre, prePhone, messages }: Props) {
  const { data: products = [] } = useProducts();
  const { data: employees = [] } = useEmployees();
  const createOrder = useCreateOrder();

  const [canal, setCanal] = useState('whatsapp');
  const [pago, setPago] = useState('transfer');
  const [nombre, setNombre] = useState(preNombre ?? '');
  const [telefono, setTelefono] = useState(prePhone ?? '');
  const [direccion, setDireccion] = useState('');
  const [empleadoId, setEmpleadoId] = useState('');
  const [items, setItems] = useState<any[]>([]);

  const hasDirty = !!(nombre.trim() || telefono.trim() || direccion.trim() || items.length > 0);

  function handleClose() {
    if (hasDirty && !window.confirm('¿Salir? Los datos ingresados se perderán.')) return;
    onClose();
  }

  async function handleSubmit() {
    if (!ticketId) { toast('El pedido debe crearse desde un ticket de WhatsApp', true); return; }
    if (!nombre.trim()) { toast('El nombre es obligatorio', true); return; }
    if (!direccion.trim()) { toast('La dirección es obligatoria', true); return; }
    if (items.length === 0) { toast('Agrega al menos un producto', true); return; }
    try {
      await createOrder.mutateAsync({
        fecha,
        ticket_id: ticketId,
        channel: canal,
        payment_method: pago,
        customer_name: nombre.trim(),
        customer_phone: telefono.trim() || undefined,
        address: direccion.trim(),
        employee_id: empleadoId || undefined,
        items: items.map((i: any, idx: number) => ({
          product_name: i.product_name,
          quantity_label: i.quantity_label || '',
          price: parseFloat(i.price) || 0,
          sort_order: idx,
        })),
      });
      toast('Pedido registrado');
      onClose();
    } catch (e: any) {
      toast(e.message, true);
    }
  }

  const hasChatPreview = !!messages && messages.length > 0;

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div style={{
        display: 'flex', flexDirection: 'row', width: '100%',
        maxWidth: hasChatPreview ? 960 : 700,
        margin: 'auto', borderRadius: 'var(--radb)',
        overflow: 'hidden', boxShadow: 'var(--shf)',
        animation: 'mup .2s ease',
      }}>
        {hasChatPreview && (
          <div style={{ width: 290, background: '#ECE5DD', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <div style={{ background: 'var(--vd)', color: '#fff', padding: '14px 16px', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Smartphone size={15} /> {preNombre || telefono}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 520 }}>
              {[...messages].reverse().map((m, i) => (
                <div key={i} className={`chat-msg ${m.direction === 'out' ? 'us' : 'them'}`}>
                  <div className="chat-bubble">{m.text}</div>
                  {m.created_at && (
                    <div className="chat-meta">
                      {new Date(m.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mwin" style={{
          margin: 0, flex: 1,
          borderRadius: hasChatPreview ? '0 var(--radb) var(--radb) 0' : 'var(--radb)',
          boxShadow: 'none',
        }}>
          <div className="mhead">
            <div className="mtit">Crear pedido desde ticket</div>
            <button className="mclose" onClick={handleClose}>×</button>
          </div>
          <div className="mbody">
            {ticketId && (
              <div style={{ background: 'var(--vc)', border: '2px solid var(--vm)', color: 'var(--vd)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Smartphone size={14} /> Pedido vinculado al ticket de WhatsApp
              </div>
            )}
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Canal</label>
                <select className="fi2" value={canal} onChange={(e) => setCanal(e.target.value)}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="call">Llamada</option>
                </select>
              </div>
              <div className="fg2">
                <label className="fl2">Método de pago</label>
                <select className="fi2" value={pago} onChange={(e) => setPago(e.target.value)}>
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Pagado en tienda</option>
                </select>
              </div>
            </div>
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Nombre del cliente *</label>
                <input className="fi2" placeholder="Ej: María González" value={nombre}
                  onChange={(e) => setNombre(e.target.value)} />
              </div>
              <div className="fg2">
                <label className="fl2">Teléfono</label>
                <input className="fi2" placeholder="Ej: 3001234567" value={telefono}
                  onChange={(e) => setTelefono(e.target.value)} />
              </div>
            </div>
            <div className="fg2">
              <label className="fl2">Dirección de entrega *</label>
              <input className="fi2" placeholder="Ej: Cra 45 #12-34, Casa azul" value={direccion}
                onChange={(e) => setDireccion(e.target.value)} />
            </div>
            <div className="fg2">
              <label className="fl2">Domiciliario</label>
              <select className="fi2" value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}>
                <option value="">Sin asignar</option>
                {employees.map((emp: any) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>
            <div className="stit">Productos</div>
            <ProductSearch products={products} items={items} onChange={setItems} />
            <div className="mactions">
              <button className="bsec" onClick={handleClose}>Cancelar</button>
              <button className="bpri" onClick={handleSubmit} disabled={createOrder.isPending}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                {createOrder.isPending
                  ? 'Registrando...'
                  : <><Check size={15} strokeWidth={3} /> Registrar pedido</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
