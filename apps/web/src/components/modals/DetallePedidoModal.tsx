import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Banknote, AlertTriangle, CheckCircle, ChevronDown, FileText, Send } from 'lucide-react';
import jsPDF from 'jspdf';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { useProducts } from '../../hooks/useProducts';
import { useEmployees } from '../../hooks/useEmployees';
import { STATUS_LABEL, STATUS_ORDER, fmtCOP, PAYMENT_LABEL } from '../../lib/format';
import { toast } from '../ui/Toast';
import ProductSearch from '../orders/ProductSearch';

interface Props { orderId: string; onClose: () => void; openCobro?: boolean; }

const COD_COLORS: Record<string, string> = {
  nuevo: '#94A3B8', preparando: '#F59E0B', listo: '#3B82F6',
  camino: '#8B5CF6', entregado: '#0D9488', cerrado: '#1A7A4A',
};

function formatHour(raw: string | null | undefined): string {
  if (!raw) return '-';
  if (raw.includes('T')) {
    const d = new Date(raw);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  return raw.substring(0, 5);
}

function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return '-';
  return new Date(raw).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function DetallePedidoModal({ orderId, onClose, openCobro }: Props) {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: employees = [] } = useEmployees();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<{ data: any }>(`/orders/${orderId}`).then((r) => r.data),
  });

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [pago, setPago] = useState('transfer');
  const [empleadoId, setEmpleadoId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [showHist, setShowHist] = useState(false);
  const [showCobro, setShowCobro] = useState(openCobro ?? false);
  const [replyText, setReplyText] = useState('');
  const [cobroRec, setCobroRec] = useState('');
  const [cobroBy, setCobroBy] = useState(() => user?.userId ?? (user as any)?.id ?? '');
  const [saveIndicator, setSaveIndicator] = useState<'saving' | 'saved' | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingSave = useRef(false);

  useEffect(() => {
    if (!order) return;
    setNombre(order.customer_name ?? '');
    setTelefono(order.customer_phone ?? '');
    setDireccion(order.address ?? '');
    setPago(order.payment_method === 'cod' ? 'transfer' : (order.payment_method ?? 'transfer'));
    setEmpleadoId(order.employee_id ?? '');
    setItems((order.items ?? []).map((i: any) => ({
      product_name: i.product_name ?? '',
      quantity_label: i.quantity_label ?? '',
      price: String(i.price ?? ''),
    })));
    pendingSave.current = false;
  }, [order]);

  function scheduleAutoSave() {
    pendingSave.current = true;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (pendingSave.current) {
        pendingSave.current = false;
        saveMut.mutate();
      }
    }, 2000);
  }

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // Chat always loaded if order has ticket_id
  const { data: chatData } = useQuery({
    queryKey: ['inbox-convo', order?.ticket_id],
    queryFn: () => order?.ticket_id
      ? api.get<{ data: any }>(`/inbox/${order.ticket_id}/messages`).then((r) => r.data)
      : null,
    enabled: !!order?.ticket_id,
    refetchInterval: 15000,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatData?.messages?.length]);

  const saveMut = useMutation({
    mutationFn: () => api.patch(`/orders/${orderId}`, {
      customer_name: nombre,
      customer_phone: telefono,
      address: direccion,
      payment_method: pago,
      employee_id: empleadoId || null,
      items: items.map((i, idx) => ({
        product_name: i.product_name,
        quantity_label: i.quantity_label,
        price: parseFloat(i.price) || 0,
        sort_order: idx,
      })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      if (isAdmin) {
        setSaveIndicator('saved');
        setTimeout(() => setSaveIndicator(null), 2000);
      }
    },
    onError: (e: any) => { if (isAdmin) toast(e.message, true); },
  });

  const moveMut = useMutation({
    mutationFn: (status: string) => api.patch(`/orders/${orderId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
    },
    onError: (e: any) => toast(e.message, true),
  });

  const papeleraMut = useMutation({
    mutationFn: () => api.patch(`/orders/${orderId}/status`, { status: 'papelera' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); toast('Pedido enviado a papelera'); onClose(); },
    onError: (e: any) => toast(e.message, true),
  });

  const invoiceMut = useMutation({
    mutationFn: (text: string) => api.post(`/inbox/${order?.ticket_id}/reply`, { text }),
    onSuccess: () => toast('Factura enviada al chat'),
    onError: (e: any) => toast(e.message, true),
  });

  const replyMut = useMutation({
    mutationFn: (text: string) => api.post(`/inbox/${order?.ticket_id}/reply`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', order?.ticket_id] });
      setReplyText('');
    },
    onError: (e: any) => toast(e.message, true),
  });

  function markDirty() { scheduleAutoSave(); }

  function generatePDF(): void {
    if (!order) return;
    const invoiceTotal = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
    const doc = new jsPDF({ unit: 'mm', format: [80, 200] });
    doc.setFont('helvetica');
    let y = 10;

    doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text('Fruver San Gabriel', 40, y, { align: 'center' }); y += 7;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Pedido #${order.num}`, 40, y, { align: 'center' }); y += 5;
    doc.text(new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' }), 40, y, { align: 'center' }); y += 5;
    doc.line(3, y, 77, y); y += 5;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold'); doc.text('Cliente:', 3, y);
    doc.setFont('helvetica', 'normal');
    const cLines = doc.splitTextToSize(order.customer_name, 52);
    doc.text(cLines, 22, y); y += cLines.length * 4 + 1;

    doc.setFont('helvetica', 'bold'); doc.text('Dirección:', 3, y);
    doc.setFont('helvetica', 'normal');
    const aLines = doc.splitTextToSize(order.address, 50);
    doc.text(aLines, 24, y); y += aLines.length * 4 + 1;

    if (order.customer_phone) {
      doc.setFont('helvetica', 'bold'); doc.text('Tel:', 3, y);
      doc.setFont('helvetica', 'normal'); doc.text(order.customer_phone, 15, y); y += 5;
    }

    doc.line(3, y, 77, y); y += 5;
    doc.setFont('helvetica', 'bold'); doc.text('Productos:', 3, y); y += 5;
    doc.setFont('helvetica', 'normal');

    items.forEach((i) => {
      const price = parseFloat(i.price) || 0;
      const label = `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`;
      const priceStr = `$${price.toLocaleString('es-CO')}`;
      const lLines = doc.splitTextToSize(label, 48);
      doc.text(lLines, 3, y);
      doc.text(priceStr, 77, y, { align: 'right' });
      y += lLines.length * 4 + 1;
    });

    y += 2; doc.line(3, y, 77, y); y += 5;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('Total:', 3, y);
    doc.text(`$${invoiceTotal.toLocaleString('es-CO')}`, 77, y, { align: 'right' }); y += 6;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`Pago: ${PAYMENT_LABEL[pago] ?? pago}`, 3, y); y += 5;
    doc.line(3, y, 77, y); y += 5;
    doc.setFontSize(8); doc.text('Gracias por su compra!', 40, y, { align: 'center' });

    doc.save(`Factura_${order.num}.pdf`);
  }

  function sendInvoiceToChat() {
    if (!order?.ticket_id) { toast('Este pedido no tiene chat asociado', true); return; }
    // Send short note to chat (PDF delivered separately)
    const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
    const note = `📄 *Factura #${order.num}*\nCliente: ${order.customer_name}\nTotal: $${total.toLocaleString('es-CO')}\n_Factura PDF enviada_`;
    invoiceMut.mutate(note);
    generatePDF();
  }

  function copyInvoice() {
    if (!order) return;
    const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
    const lines = [`Pedido #${order.num} — Fruver San Gabriel`, `Cliente: ${order.customer_name}`, `Dirección: ${order.address}`, ''];
    items.forEach(i => lines.push(`• ${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}: $${(parseFloat(i.price)||0).toLocaleString('es-CO')}`));
    lines.push('', `Total: $${total.toLocaleString('es-CO')}`, `Pago: ${PAYMENT_LABEL[pago] ?? pago}`);
    navigator.clipboard.writeText(lines.join('\n'));
    toast('Copiado al portapapeles');
  }

  const cobroMut = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/cobro`, {
      amount_received: parseFloat(cobroRec) || 0,
      paid_by: cobroBy || user?.userId || (user as any)?.id,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      toast('Pago confirmado');
      setShowCobro(false);
    },
    onError: (e: any) => toast(e.message, true),
  });

  function handleChatKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const txt = replyText.trim();
      if (txt && !replyMut.isPending) replyMut.mutate(txt);
    }
  }

  function handleClose() {
    if (pendingSave.current || catalogDirty) {
      if (!window.confirm('Hay cambios sin guardar. ¿Salir de todos modos?')) return;
      clearTimeout(saveTimerRef.current);
    }
    onClose();
  }

  if (isLoading || !order) return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className="mwin"><div className="mbody" style={{ textAlign: 'center', color: 'var(--gt)' }}>Cargando...</div></div>
    </div>
  );

  const locked = order.locked;
  const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
  const recibido = parseFloat(cobroRec) || 0;
  const devolucion = recibido - total;
  const faltaOSobra = recibido > 0 ? (devolucion >= 0 ? `Vuelto: ${fmtCOP(devolucion)}` : `Falta: ${fmtCOP(-devolucion)}`) : null;
  const cobroValido = recibido >= total && recibido > 0;
  const hasChatPanel = !!order.ticket_id;

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      {/* Split layout: LEFT=chat, RIGHT=order (only when ticket exists) */}
      <div style={{
        display: 'flex', flexDirection: 'row',
        width: '100%', maxWidth: hasChatPanel ? 1060 : 700,
        margin: 'auto', borderRadius: 'var(--radb)',
        overflow: 'hidden', boxShadow: 'var(--shf)', animation: 'mup .2s ease',
        maxHeight: '90vh',
      }}>

        {/* ===== LEFT: CHAT PANEL ===== */}
        {hasChatPanel && (
          <div style={{
            width: 300, background: '#ECE5DD', display: 'flex',
            flexDirection: 'column', flexShrink: 0, minHeight: 0,
          }}>
            {/* Chat header */}
            <div style={{ background: 'var(--vd)', color: '#fff', padding: '12px 14px', flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {order.customer_name}
              </div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{order.customer_phone}</div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 6px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {!chatData && (
                <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: 16 }}>Cargando chat...</div>
              )}
              {chatData?.messages?.map((msg: any, i: number) => {
                const isOut = msg.direction === 'out';
                return (
                  <div key={msg.id ?? i} style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      background: isOut ? '#DCF8C6' : '#fff',
                      borderRadius: isOut ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      padding: '7px 10px', maxWidth: '85%', fontSize: 12,
                      boxShadow: '0 1px 2px rgba(0,0,0,.1)',
                    }}>
                      {isOut && msg.sender?.name && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--vd)', marginBottom: 2 }}>{msg.sender.name}</div>
                      )}
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
                      <div style={{ fontSize: 10, color: '#999', textAlign: 'right', marginTop: 2 }}>
                        {new Date(msg.sent_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              {chatData && (!chatData.messages || chatData.messages.length === 0) && (
                <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: 16 }}>Sin mensajes</div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply (admin only) */}
            {isAdmin && (
              <div style={{
                display: 'flex', gap: 6, padding: '8px 8px',
                borderTop: '1px solid rgba(0,0,0,.1)', background: '#F0F0F0', flexShrink: 0,
              }}>
                <textarea
                  placeholder="Responder... (Enter envía)"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  rows={1}
                  style={{
                    flex: 1, border: '1.5px solid var(--brd)', borderRadius: 8,
                    padding: '6px 9px', fontSize: 12, resize: 'none', fontFamily: 'inherit',
                    background: '#fff',
                  }}
                />
                <button
                  onClick={() => { const txt = replyText.trim(); if (txt) replyMut.mutate(txt); }}
                  disabled={!replyText.trim() || replyMut.isPending}
                  style={{
                    background: 'var(--v)', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '0 10px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', fontSize: 12, flexShrink: 0,
                  }}>
                  <Send size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===== RIGHT: ORDER DETAIL ===== */}
        <div className="mwin" style={{
          margin: 0, flex: 1, minWidth: 0,
          borderRadius: hasChatPanel ? '0 var(--radb) var(--radb) 0' : 'var(--radb)',
          boxShadow: 'none', overflowY: 'auto', maxHeight: '90vh',
        }}>
          <div className="mhead">
            <div>
              <div className="mtit" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Pedido #{order.num}
                {isAdmin && saveIndicator === 'saved' && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--v)' }}>✓ guardado</span>
                )}
              </div>
              <div className="msub">
                {order.channel === 'whatsapp' ? 'WhatsApp' : 'Llamada'}
                {order.order_hour && (
                  <span style={{ marginLeft: 6, color: 'var(--gt)', fontWeight: 600 }}>
                    — {formatHour(order.order_hour)}
                  </span>
                )}
              </div>
            </div>
            <button className="mclose" onClick={handleClose}>×</button>
          </div>

          <div className="mbody">
            {/* Info summary */}
            <div style={{ background: 'var(--vc)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 14px', fontSize: 13 }}>
              <div><span style={{ color: 'var(--gt)', fontWeight: 600 }}>Hora — </span><strong>{formatHour(order.order_hour)}</strong></div>
              <div><span style={{ color: 'var(--gt)', fontWeight: 600 }}>Estado — </span><strong>{STATUS_LABEL[order.status] ?? order.status}</strong></div>
              <div><span style={{ color: 'var(--gt)', fontWeight: 600 }}>Canal — </span><strong>{order.channel === 'whatsapp' ? 'WhatsApp' : 'Llamada'}</strong></div>
              <div><span style={{ color: 'var(--gt)', fontWeight: 600 }}>Pago — </span><strong style={{ color: order.paid ? 'var(--v)' : '#DC2626' }}>{order.paid ? 'Pagado' : 'Pendiente'}</strong></div>
            </div>

            {/* Cobro closure info (visible to all roles) */}
            {locked && (
              <div style={{ background: '#DCFCE7', border: '1.5px solid var(--vm)', borderRadius: 'var(--rad)', padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
                <div style={{ fontWeight: 800, color: 'var(--vd)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={15} color="var(--v)" /> Pedido cerrado y cobrado
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 14px' }}>
                  <div><span style={{ color: 'var(--gt)' }}>Cerrado por: </span><strong>{(order as any).paidBy?.name ?? 'Desconocido'}</strong></div>
                  <div><span style={{ color: 'var(--gt)' }}>Hora cierre: </span><strong>{formatDateTime(order.paid_at)}</strong></div>
                  <div><span style={{ color: 'var(--gt)' }}>Total: </span><strong>{fmtCOP(total)}</strong></div>
                  <div><span style={{ color: 'var(--gt)' }}>Recibido: </span><strong>{fmtCOP(Number(order.amount_received ?? 0))}</strong></div>
                  {isAdmin && (
                    <div><span style={{ color: 'var(--gt)' }}>Vuelto: </span><strong>{fmtCOP(Number(order.change_amount ?? 0))}</strong></div>
                  )}
                </div>
              </div>
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
                  onChange={(e) => { setNombre(e.target.value); markDirty(); }} />
              </div>
              <div className="fg2">
                <label className="fl2">Teléfono</label>
                <input className="fi2" disabled={locked} value={telefono}
                  onChange={(e) => { setTelefono(e.target.value); markDirty(); }} />
              </div>
            </div>
            <div className="fg2">
              <label className="fl2">Dirección</label>
              <input className="fi2" disabled={locked} value={direccion}
                onChange={(e) => { setDireccion(e.target.value); markDirty(); }} />
            </div>
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Método de pago</label>
                <select className="fi2" disabled={locked} value={pago}
                  onChange={(e) => { setPago(e.target.value); markDirty(); }}>
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Pagado en tienda</option>
                </select>
              </div>
              <div className="fg2">
                <label className="fl2">Domiciliario</label>
                <select className="fi2" disabled={locked} value={empleadoId}
                  onChange={(e) => { setEmpleadoId(e.target.value); markDirty(); }}>
                  <option value="">Sin asignar</option>
                  {employees.map((emp: any) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="stit">Productos</div>
            <ProductSearch
              products={products}
              items={items}
              locked={locked}
              onChange={(it) => { setItems(it); markDirty(); }}
              onLocalDirty={setCatalogDirty}
            />

            {/* Admin-only history */}
            {isAdmin && order.history && order.history.length > 0 && (
              <div>
                <div className={`hist-toggle${showHist ? ' open' : ''}`} onClick={() => setShowHist(!showHist)}>
                  <ChevronDown size={16} style={{ transition: 'transform .2s', transform: showHist ? 'rotate(180deg)' : 'none' }} />
                  Historial de cambios
                  <span style={{ background: 'var(--v)', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 800, marginLeft: 'auto' }}>
                    {order.history.length}
                  </span>
                </div>
                {showHist && (
                  <div className="hist-body open">
                    {order.history.map((h: any, i: number) => (
                      <div key={i} className="hitem">
                        <div className="hdot" style={{
                          background: h.action_type === 'producto_eliminado' ? '#DC2626'
                            : h.action_type === 'producto_agregado' ? 'var(--v)'
                            : h.action_type === 'cobro' ? 'var(--v)'
                            : 'var(--gt)',
                        }} />
                        <div style={{ flex: 1 }}>
                          <div>
                            <span className="hwho">{h.actor?.name ?? 'Sistema'}</span>
                            {' — '}
                            <span className="hwhat">{h.field ?? h.action_type}</span>
                          </div>
                          {(h.value_before || h.value_after) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                              {h.value_before && <span className="diff-old">— {h.value_before}</span>}
                              {h.value_before && h.value_after && <span className="diff-arrow">→</span>}
                              {h.value_after && <span className="diff-new">+ {h.value_after}</span>}
                            </div>
                          )}
                          {h.notes && <div style={{ fontSize: 12, color: 'var(--gt)', marginTop: 2 }}>{h.notes}</div>}
                          <div className="hwhen">
                            {new Date(h.created_at).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mactions" style={{ flexWrap: 'wrap' }}>
              {!locked && isAdmin && order.status !== 'papelera' && (
                <button className="bdel" onClick={() => {
                  if (window.confirm('¿Mover este pedido a la papelera?')) papeleraMut.mutate();
                }} disabled={papeleraMut.isPending}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Trash2 size={14} /> Papelera
                </button>
              )}
              <button className="bsec" onClick={handleClose}>Cerrar</button>
              {items.length > 0 && (
                <button className="bsec" onClick={copyInvoice}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={14} /> Copiar
                </button>
              )}
              {items.length > 0 && (
                <button className="bsec" onClick={generatePDF}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={14} /> PDF
                </button>
              )}
              {items.length > 0 && isAdmin && order.ticket_id && (
                <button className="bsec" onClick={sendInvoiceToChat}
                  disabled={invoiceMut.isPending}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'var(--v)', color: 'var(--v)' }}>
                  <Send size={14} /> Enviar factura al chat
                </button>
              )}
              {!locked && (order.status === 'camino' || order.status === 'entregado') && !order.paid && (
                <button className="bverde" onClick={() => setShowCobro(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Banknote size={15} /> Confirmar cobro
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* COBRO DIALOG */}
      {showCobro && (
        <div className="moverlay on" style={{ zIndex: 700 }}>
          <div className="cobrobox">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <Banknote size={32} color="var(--v)" strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}>Confirmar pago</div>
            <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--gt)', marginBottom: 16 }}>
              {order.customer_name} — Total: <strong>{fmtCOP(total)}</strong>
            </div>
            <div style={{ background: 'var(--ac)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--a)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} /> Una vez confirmado, el pedido quedará bloqueado.
            </div>
            <div className="fg2">
              <label className="fl2">¿Quién recibió el pago?</label>
              <select className="fi2" value={cobroBy} onChange={(e) => setCobroBy(e.target.value)}>
                {(() => {
                  const myId = user?.userId ?? (user as any)?.id ?? '';
                  const myName = user?.name ?? 'Yo';
                  return <>
                    <option value={myId}>{myName}</option>
                    {employees.filter((e: any) => e.id !== myId).map((e: any) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </>;
                })()}
              </select>
            </div>
            <div className="fg2">
              <label className="fl2">¿Cuánto entregó el domiciliario? <span style={{ color: 'var(--r)', fontWeight: 800 }}>*</span></label>
              <input className="fi2" type="number" placeholder={`Mínimo: $${total.toLocaleString('es-CO')}`}
                value={cobroRec} onChange={(e) => setCobroRec(e.target.value)}
                style={{ borderColor: cobroRec && !cobroValido ? 'var(--r)' : undefined }} />
              {faltaOSobra && (
                <div style={{
                  fontSize: 13, marginTop: 6, fontWeight: 700,
                  color: devolucion >= 0 ? 'var(--v)' : 'var(--r)',
                  background: devolucion >= 0 ? 'var(--vc)' : 'var(--rc)',
                  borderRadius: 8, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {devolucion >= 0 ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
                  {faltaOSobra}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
              <button className="bsec" onClick={() => { setShowCobro(false); onClose(); }}>Cancelar</button>
              <button className="bpri" onClick={() => cobroMut.mutate()}
                disabled={cobroMut.isPending || !cobroValido}
                title={!cobroValido && recibido > 0 ? `Faltan ${fmtCOP(total - recibido)}` : undefined}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: cobroValido ? 1 : 0.5 }}>
                {cobroMut.isPending ? 'Confirmando...' : <><CheckCircle size={15} /> Confirmar pago</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
