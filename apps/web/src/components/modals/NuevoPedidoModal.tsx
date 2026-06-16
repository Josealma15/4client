import { useState } from 'react';
import { useProducts } from '../../hooks/useProducts';
import { useEmployees } from '../../hooks/useEmployees';
import { useCreateOrder } from '../../hooks/useOrders';
import { toast } from '../ui/Toast';
import ProductSearch from '../orders/ProductSearch';

interface Props { fecha: string; onClose: () => void; }

const EMPTY_ITEMS: any[] = [];

export default function NuevoPedidoModal({ fecha, onClose }: Props) {
  const { data: products = [] } = useProducts();
  const { data: employees = [] } = useEmployees();
  const createOrder = useCreateOrder();

  const [canal, setCanal] = useState('whatsapp');
  const [pago, setPago] = useState('cod');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [empleadoId, setEmpleadoId] = useState('');
  const [items, setItems] = useState(EMPTY_ITEMS);

  async function handleSubmit() {
    if (!nombre.trim()) { toast('El nombre es obligatorio', true); return; }
    if (!direccion.trim()) { toast('La dirección es obligatoria', true); return; }
    if (items.length === 0) { toast('Agrega al menos un producto', true); return; }

    try {
      await createOrder.mutateAsync({
        fecha,
        canal,
        payment_method: pago,
        customer_name: nombre.trim(),
        phone: telefono.trim() || undefined,
        address: direccion.trim(),
        employee_id: empleadoId || undefined,
        items: items.map((i: any) => ({
          product_id: i.productId,
          quantity_label: i.quantity_label,
          price: parseFloat(i.price) || 0,
        })),
      });
      toast('Pedido registrado');
      onClose();
    } catch (e: any) {
      toast(e.message, true);
    }
  }

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mwin" style={{ maxWidth: 700 }}>
        <div className="mhead">
          <div className="mtit">Registrar nuevo pedido</div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="mbody">
          <div className="frow">
            <div className="fg2">
              <label className="fl2">Canal</label>
              <select className="fi2" value={canal} onChange={(e) => setCanal(e.target.value)}>
                <option value="whatsapp">📱 WhatsApp</option>
                <option value="phone">📞 Llamada</option>
              </select>
            </div>
            <div className="fg2">
              <label className="fl2">Método de pago</label>
              <select className="fi2" value={pago} onChange={(e) => setPago(e.target.value)}>
                <option value="cod">💵 Cobra en casa</option>
                <option value="transfer">📲 Transferencia</option>
                <option value="cash">💳 Pagado en tienda</option>
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
              <option value="">— Sin asignar —</option>
              {employees.map((emp: any) => (
                <option key={emp.id} value={emp.id}>🛵 {emp.name}</option>
              ))}
            </select>
          </div>
          <div className="stit">Productos</div>
          <ProductSearch products={products} items={items} onChange={setItems} />
          <div className="mactions">
            <button className="bsec" onClick={onClose}>Cancelar</button>
            <button className="bpri" onClick={handleSubmit} disabled={createOrder.isPending}>
              {createOrder.isPending ? 'Registrando...' : '✓ Registrar pedido'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
