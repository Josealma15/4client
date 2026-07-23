import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Banknote, AlertTriangle, CheckCircle, ChevronDown, FileText, Send, Lock, Bell, ClipboardList, Ban } from 'lucide-react';
import jsPDF from 'jspdf';
import { api } from '../../lib/api';
import { buildFormLinkMessage } from '../../lib/formLinkMessage';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { useProducts } from '../../hooks/useProducts';
import { useEmployees } from '../../hooks/useEmployees';
import { useDiaCerrado } from '../../hooks/useCierre';
import { useWithinFormHours, FORM_HOURS_CLOSED_MSG } from '../../hooks/useFormHours';
import { STATUS_LABEL, STATUS_ORDER, fmtCOP, PAYMENT_LABEL, todayStr } from '../../lib/format';
import { formatPhoneDisplay } from '../../lib/formatPhone';
import { toast } from '../ui/Toast';
import ProductSearch from '../orders/ProductSearch';
import { ConfirmModal } from '../ui/ConfirmModal';
import HistoryTable from '../ui/HistoryTable';
import PasswordInput from '../ui/PasswordInput';

interface Props { orderId: string; onClose: () => void; openCobro?: boolean; }

const COD_COLORS: Record<string, string> = {
  nuevo: '#94A3B8', preparando: '#F59E0B', listo: '#3B82F6',
  camino: '#8B5CF6', entregado: '#0D9488', cerrado: '#1A7A4A',
};

function formatHour(raw: string | null | undefined): string {
  if (!raw) return '-';
  // order_hour is a DB TIME column (no date/timezone) stored using the server's clock
  // (UTC on Railway). Prisma serializes it as an epoch-day ISO string with a "Z" suffix,
  // so it must be converted to Colombia local time explicitly - reading getUTCHours()
  // directly (old behavior) showed the raw UTC hour, ~5h ahead of the real local time.
  const d = raw.includes('T') ? new Date(raw) : new Date(`1970-01-01T${raw}Z`);
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
}

function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return '-';
  return new Date(raw).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  });
}

// order.fecha is a DATE-only column (no real time-of-day), serialized as midnight UTC
// for that calendar day. Converting that straight through a Bogota (UTC-5) timezone
// conversion — like formatDateTime does for real timestamps — reads it as 7pm the
// PREVIOUS day, which is exactly why an invoice for a past pedido was printing
// today's date if built from `new Date()`, or would print the wrong day even if built
// from the order's own fecha the naive way. Pin to noon UTC first so no timezone
// offset in practical use can push it across a day boundary either direction.
function formatFechaLong(raw: string | null | undefined): string {
  if (!raw) return '-';
  const ymd = raw.split('T')[0];
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Bogota',
  });
}

const URL_RE = /(https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]{1,2000})/g;
function renderText(text: string) {
  const parts = text.split(URL_RE);
  URL_RE.lastIndex = 0;
  return parts.map((p, i) => {
    URL_RE.lastIndex = 0;
    return URL_RE.test(p)
      ? <a key={i} href={p} target="_blank" rel="noreferrer noopener"
          style={{ color: 'var(--v)', textDecoration: 'underline', wordBreak: 'break-all' }}>{p}</a>
      : p;
  });
}

export default function DetallePedidoModal({ orderId, onClose, openCobro }: Props) {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAdmin = user?.role === 'admin';
  // encargado has the same order-management permissions as admin everywhere else in
  // the app (can cobro, move status, etc. - see requireRole('admin', 'encargado') on
  // the backend) except this modal, where a stricter admin-only isAdmin left them
  // without the papelera button and other actions admin has on the exact same order.
  const canManage = isAdmin || user?.role === 'encargado' || user?.role === 'dev';
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: employees = [] } = useEmployees();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<{ data: any }>(`/orders/${orderId}`).then((r) => r.data),
  });

  // The order's OWN day, not whatever day the caller happened to be viewing when it
  // opened this modal - this can be opened from search/notifications too, not just
  // the board for the currently-selected date.
  const orderFecha: string | undefined = order?.fecha ? new Date(order.fecha).toISOString().split('T')[0] : undefined;
  const { data: cierreStatus } = useDiaCerrado(orderFecha);
  const diaCerrado = cierreStatus?.cerrado ?? false;
  const withinFormHours = useWithinFormHours();

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [pago, setPago] = useState('transfer');
  const [empleadoId, setEmpleadoId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [catalogClearKey, setCatalogClearKey] = useState(0);
  const [showHist, setShowHist] = useState(false);
  const [showCobro, setShowCobro] = useState(openCobro ?? false);
  const [replyText, setReplyText] = useState('');
  const [cobroRec, setCobroRec] = useState('');
  const [cobroPass, setCobroPass] = useState('');
  const [confirmDlg, setConfirmDlg] = useState<{ msg: string; onOk: () => void; danger?: boolean; onSave?: () => void } | null>(null);

  useEffect(() => {
    if (!order) return;
    // Don't stomp an in-progress edit - if the person has unsaved local changes when
    // a live update lands (e.g. the client added items to this order from the form),
    // the fresh data is still in the cache for whenever they save/close, but pulling
    // it into the form fields right now would silently discard what they were typing.
    if (isDirty || catalogDirty) return;
    setNombre(order.customer_name ?? '');
    setTelefono(order.customer_phone ?? '');
    setDireccion(order.address ?? '');
    setPago(order.payment_method ?? 'transfer');
    setEmpleadoId(order.employee_id ?? '');
    setItems((order.items ?? []).map((i: any) => ({
      product_name: i.product_name ?? '',
      quantity_label: i.quantity_label ?? '',
      price: String(i.price ?? ''),
      added_by_client: !!i.added_by_client,
    })));
    setIsDirty(false);
    // Trashed orders are opened specifically to see what happened (who sent it to
    // papelera, when) - that's in the history, so show it expanded right away
    // instead of making the person hunt for the toggle.
    if (order.status === 'papelera') setShowHist(true);
  }, [order]);

  // Live-update this open order when it changes elsewhere - most importantly, a
  // client adding items to it via the form (merge flow) while a staff member already
  // has it open. Without this, they'd only see the new items after closing and
  // reopening the modal.
  useEffect(() => {
    if (!accessToken || !orderId) return;
    const sock = getSocket(accessToken);
    const onOrderChange = (data: any) => {
      const changedId = data?.id ?? data?.orderId;
      if (changedId !== orderId) return;
      if (isDirty || catalogDirty) {
        toast('Este pedido se actualizó (el cliente agregó productos) - guarda tus cambios para no perderlos');
      }
      // order:updated already carries the FULL fresh order (public.ts/orders.ts emit
      // the complete row) - write it straight into the cache instead of just
      // invalidating and waiting on a redundant network refetch. That extra round
      // trip was the visible lag between a client's edit landing and this modal
      // (when not mid-edit itself) actually showing the new address/payment/items.
      if (data?.id && data?.items) {
        qc.setQueryData(['order', orderId], data);
      } else {
        qc.invalidateQueries({ queryKey: ['order', orderId] });
      }
    };
    sock.on('order:updated', onOrderChange);
    sock.on('order:paid', onOrderChange);
    return () => {
      sock.off('order:updated', onOrderChange);
      sock.off('order:paid', onOrderChange);
    };
  }, [accessToken, orderId, qc, isDirty, catalogDirty]);


  // Chat always loaded if order has ticket_id
  const { data: chatData } = useQuery({
    queryKey: ['inbox-convo', order?.ticket_id],
    queryFn: () => order?.ticket_id
      ? api.get<{ data: any }>(`/inbox/${order.ticket_id}/messages`).then((r) => r.data)
      : null,
    enabled: !!order?.ticket_id,
    // Fallback only - real-time delivery is via socket, but a missed/late socket event
    // shouldn't leave this open conversation stale for longer than this.
    refetchInterval: 30000,
  });

  // Real-time chat push via socket
  useEffect(() => {
    if (!accessToken || !order?.ticket_id) return;
    const sock = getSocket(accessToken);
    const onMsg = (data: { ticketId: string }) => {
      if (data?.ticketId === order.ticket_id) {
        qc.invalidateQueries({ queryKey: ['inbox-convo', order.ticket_id] });
      }
    };
    sock.on('ticket:message', onMsg);
    return () => { sock.off('ticket:message', onMsg); };
  }, [accessToken, order?.ticket_id, qc]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatData?.messages?.length]);

  const saveMut = useMutation({
    mutationFn: () => api.patch(`/orders/${orderId}`, {
      customer_name: nombre,
      address: direccion,
      payment_method: pago,
      employee_id: empleadoId || null,
      items: items.map((i, idx) => ({
        product_name: i.product_name,
        quantity_label: i.quantity_label,
        price: parseFloat(i.price) || 0,
        sort_order: idx,
        added_by_client: !!i.added_by_client,
      })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      setIsDirty(false);
      setCatalogDirty(false);
      setCatalogClearKey(k => k + 1);
      toast('Cambios guardados');
      onClose();
    },
    onError: (e: any) => toast(e.message, true),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', order?.ticket_id] });
      toast('Factura enviada al chat');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const replyMut = useMutation({
    mutationFn: (text: string) => api.post<{ data: any; wpp_status: string; wpp_error?: string }>(`/inbox/${order?.ticket_id}/reply`, { text }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', order?.ticket_id] });
      setReplyText('');
      // This panel silently dropped WhatsApp send failures (e.g. outside Meta's 24h
      // customer-service window) - the message still saved+showed here, so staff had
      // no way to know it never reached the client. InboxPanel already surfaces this;
      // match it here.
      if (res?.wpp_status === 'failed') {
        toast(`Mensaje guardado pero falló el envío a WhatsApp: ${res.wpp_error ?? 'error Meta API'}`, true);
      } else if (res?.wpp_status === 'no_credentials') {
        toast('Mensaje guardado, pero este negocio no tiene WhatsApp conectado', true);
      }
    },
    onError: (e: any) => toast(e.message, true),
  });

  const formLinkMut = useMutation({
    mutationFn: (text: string) => api.post(`/inbox/${order?.ticket_id}/reply`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', order?.ticket_id] });
      toast('Formulario enviado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  async function sendFormLink() {
    if (!order?.ticket_id) return;
    try {
      const res = await api.get<{ data: { url: string } }>(`/inbox/${order.ticket_id}/form-link`);
      formLinkMut.mutate(buildFormLinkMessage(res.data.url));
    } catch {
      toast('No se pudo generar el link', true);
    }
  }

  const blockLinkMut = useMutation({
    mutationFn: () => api.post(`/inbox/${order?.ticket_id}/form-link/revoke`, {}),
    onSuccess: () => toast('Link bloqueado - el cliente ya no puede usarlo'),
    onError: (e: any) => toast(e.message ?? 'No se pudo bloquear el link', true),
  });

  function markDirty() { setIsDirty(true); }

  function buildPDFDoc(): jsPDF | null {
    if (!order) return null;
    const invoiceTotal = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
    const doc = new jsPDF({ unit: 'mm', format: [80, 200] });
    doc.setFont('helvetica');
    let y = 10;

    doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text(user?.orgName ?? '4Client', 40, y, { align: 'center' }); y += 7;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Pedido #${order.num}`, 40, y, { align: 'center' }); y += 5;
    doc.text(formatFechaLong(order.fecha), 40, y, { align: 'center' }); y += 5;
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
      doc.setFont('helvetica', 'normal'); doc.text(formatPhoneDisplay(order.customer_phone), 15, y); y += 5;
    }

    doc.line(3, y, 77, y); y += 5;
    // Column table - Producto | Cantidad | Precio, each value aligned under its own
    // header instead of one concatenated line, so a printed copy reads like a real
    // invoice/receipt rather than a run-on list.
    doc.setFont('helvetica', 'bold');
    doc.text('Producto', 3, y);
    doc.text('Cant.', 48, y, { align: 'center' });
    doc.text('Precio', 77, y, { align: 'right' });
    y += 4;
    doc.line(3, y, 77, y); y += 4;
    doc.setFont('helvetica', 'normal');

    items.forEach((i) => {
      const price = parseFloat(i.price) || 0;
      const priceStr = `$${price.toLocaleString('es-CO')}`;
      const nameLines = doc.splitTextToSize(i.product_name, 34);
      doc.text(nameLines, 3, y);
      doc.text(i.quantity_label || '-', 48, y, { align: 'center' });
      doc.text(priceStr, 77, y, { align: 'right' });
      y += nameLines.length * 4 + 1.5;
    });

    y += 2; doc.line(3, y, 77, y); y += 5;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('Total:', 3, y);
    doc.text(`$${invoiceTotal.toLocaleString('es-CO')}`, 77, y, { align: 'right' }); y += 6;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`Pago: ${PAYMENT_LABEL[pago] ?? pago}`, 3, y); y += 5;
    doc.line(3, y, 77, y); y += 5;
    doc.setFontSize(8); doc.text('Gracias por su compra!', 40, y, { align: 'center' });

    return doc;
  }

  function generatePDF(): void {
    const doc = buildPDFDoc();
    if (!doc || !order) return;
    // doc.save() always forces a browser download with no way to opt out - open it in
    // a new tab instead so the browser's own PDF viewer shows it; downloading from
    // there, if wanted, stays a deliberate action the person takes themselves.
    window.open(doc.output('bloburl'), '_blank');
  }

  async function sendInvoiceToChat() {
    if (!order?.ticket_id) { toast('Este pedido no tiene chat asociado', true); return; }
    const doc = buildPDFDoc();
    if (!doc || !order) return;
    try {
      const base64 = doc.output('datauristring').split(',')[1];
      const res = await api.post<{ url: string }>('/files/invoice', { data: base64, num: order.num, order_id: order.id });
      const url = res.url;
      const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
      const orgName = user?.orgName ?? '4Client';
      const msg = `Factura Pedido #${order.num} - ${orgName}\nFecha: ${formatFechaLong(order.fecha)}\nCliente: ${order.customer_name}\nTotal: $${total.toLocaleString('es-CO')}\nVisualiza tu factura: ${url}`;
      invoiceMut.mutate(msg);
    } catch {
      toast('Error al subir la factura', true);
    }
  }

  function copyInvoice() {
    if (!order) return;
    const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
    const lines = [
      `Pedido #${order.num} - ${user?.orgName ?? '4Client'}`,
      `Fecha: ${formatFechaLong(order.fecha)}`,
      `Cliente: ${order.customer_name}`,
      ...(order.customer_phone ? [`Teléfono: ${formatPhoneDisplay(order.customer_phone)}`] : []),
      `Dirección: ${order.address}`,
      `Método de pago: ${PAYMENT_LABEL[pago] ?? pago}`,
      '',
    ];
    items.forEach(i => lines.push(`• ${i.product_name}${i.quantity_label ? ' - ' + i.quantity_label : ''}: $${(parseFloat(i.price)||0).toLocaleString('es-CO')}`));
    lines.push('', `Total: $${total.toLocaleString('es-CO')}`);
    navigator.clipboard.writeText(lines.join('\n'));
    toast('Copiado al portapapeles');
  }

  const cobroMut = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/cobro`, {
      amount_received: parseFloat(cobroRec) || 0,
      password: cobroPass,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      toast('Pago confirmado');
      setShowCobro(false);
      onClose();
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
    if (isDirty || catalogDirty) {
      setConfirmDlg({
        msg: 'Hay cambios sin guardar.',
        onOk: onClose,
        onSave: () => saveMut.mutate(undefined, { onSuccess: () => setConfirmDlg(null) }),
      });
      return;
    }
    onClose();
  }

  if (isLoading || !order) return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className="mwin"><div className="mbody" style={{ textAlign: 'center', color: 'var(--gt)' }}>Cargando...</div></div>
    </div>
  );

  const locked = order.locked;
  // Frozen because its day was closed (regardless of this specific order's own
  // `locked` flag - even an order left "dejar_activo" at cierre time stops being
  // editable once that day is history) vs. frozen because it was individually paid
  // and closed - same read-only effect, different reason, so the "already
  // paid/closed" info banner below stays tied to `locked` alone, not `readOnly`.
  // A papelera order is also frozen - opened from the Papelera tab purely to see what
  // happened to it (who trashed it, when, with what items/prices), not to edit or
  // move it. It isn't necessarily `locked` (papelera never sets that flag) or on a
  // closed day, so without this it'd otherwise still show live "Mover pedido"/
  // "Guardar" controls on something that's already been thrown out.
  const readOnly = locked || diaCerrado || order.status === 'papelera';
  // Same reasoning as TicketModal - the link itself already expires by end of the
  // Colombia day it was sent, so sending/blocking one from a past-day order's chat
  // is always acting on an already-dead link. Also true the moment TODAY's caja
  // gets closed early (cierre.ts only allows closing today, so a closed diaCerrado
  // here always means "today, already closed" - not some future/past mismatch).
  const isPastDay = (!!orderFecha && orderFecha < todayStr()) || diaCerrado;
  const total = items.reduce((s: number, i: any) => s + (parseFloat(i.price) || 0), 0);
  const recibido = parseFloat(cobroRec) || 0;
  const devolucion = recibido - total;
  const faltaOSobra = recibido > 0 ? (devolucion >= 0 ? `Vuelto: ${fmtCOP(devolucion)}` : `Falta: ${fmtCOP(-devolucion)}`) : null;
  // A pedido can't be closed with any of these missing - mirrors the same check enforced
  // server-side in POST /orders/:id/cobro, so the UI blocks it before the request even goes out.
  const cierreMissing: string[] = [];
  if (!nombre.trim()) cierreMissing.push('nombre');
  if (!telefono.trim()) cierreMissing.push('teléfono');
  if (!direccion.trim() || direccion.trim().toLowerCase() === 'pendiente de confirmar') cierreMissing.push('dirección');
  if (!pago || pago === 'sin_asignar') cierreMissing.push('método de pago');
  if (!empleadoId) cierreMissing.push('domiciliario');
  if (items.length === 0) cierreMissing.push('productos');
  const unpriced = items.filter((i: any) => !(parseFloat(i.price) > 0));
  if (unpriced.length > 0) cierreMissing.push(`precio de ${unpriced.map((i: any) => i.product_name).join(', ')}`);
  const cobroValido = cierreMissing.length === 0 && recibido >= total && recibido > 0 && cobroPass.trim().length > 0;
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
            <div style={{ background: 'var(--vd)', color: '#fff', padding: '12px 14px', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {order.customer_name}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{formatPhoneDisplay(order.customer_phone)}</div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                <button
                  className="hdr-ic-btn"
                  title={isPastDay ? 'Este pedido es de un día anterior o su caja ya cerró - el link ya expiró' : !withinFormHours ? FORM_HOURS_CLOSED_MSG : 'Enviar formulario de pedido al cliente'}
                  onClick={sendFormLink}
                  disabled={formLinkMut.isPending || isPastDay || !withinFormHours}
                >
                  <ClipboardList size={13} />
                  Formulario
                </button>
                <button
                  className="hdr-ic-btn"
                  title={isPastDay ? 'Este pedido es de un día anterior o su caja ya cerró - el link ya expiró' : !withinFormHours ? FORM_HOURS_CLOSED_MSG : 'Bloquear el link de formulario enviado a este cliente'}
                  onClick={() => setConfirmDlg({
                    msg: 'Vas a bloquear el link del formulario - el cliente no podrá usarlo y tendrás que enviarle uno nuevo. ¿Deseas bloquearlo?',
                    onOk: () => blockLinkMut.mutate(),
                    danger: true,
                  })}
                  disabled={blockLinkMut.isPending || isPastDay || !withinFormHours}
                >
                  <Ban size={13} />
                  <span>Bloquear<br />Link</span>
                </button>
              </div>
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
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderText(msg.text)}</div>
                      <div style={{ fontSize: 10, color: '#999', textAlign: 'right', marginTop: 2 }}>
                        {new Date(msg.sent_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}
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

            {/* Reply bar - visible to all roles */}
            <div style={{
              display: 'flex', gap: 6, padding: '8px 8px',
              borderTop: '1px solid rgba(0,0,0,.1)', background: '#F0F0F0', flexShrink: 0,
            }}>
              <textarea
                placeholder="Responder... (Enter envía)"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={handleChatKeyDown}
                rows={3}
                style={{
                  flex: 1, border: '1.5px solid var(--brd)', borderRadius: 8,
                  padding: '8px 10px', fontSize: 13, resize: 'none', fontFamily: 'inherit',
                  background: '#fff', lineHeight: 1.4,
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
          </div>
        )}

        {/* ===== RIGHT: ORDER DETAIL ===== */}
        <div className="mwin" style={{
          margin: 0, flex: 1, minWidth: 0,
          borderRadius: hasChatPanel ? '0 var(--radb) var(--radb) 0' : 'var(--radb)',
          boxShadow: 'none', maxHeight: '90vh',
        }}>
          <div className="mhead">
            <div>
              <div className="mtit" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Pedido #{order.num}
                {order.client_modified && (
                  <span title="El cliente modificó este pedido desde el formulario - revisa los cambios (en rojo). Este aviso queda permanente, no se quita al guardar."
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: '#DC2626' }}>
                    <Bell size={12} color="#fff" fill="#fff" />
                  </span>
                )}
                {isDirty && !readOnly && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--a)' }}>● cambios sin guardar</span>
                )}
              </div>
              <div className="msub">
                {order.channel === 'whatsapp' ? 'WhatsApp' : 'Llamada'}
                {order.order_hour && (
                  <span style={{ marginLeft: 6, color: 'var(--gt)', fontWeight: 600 }}>
                    · {formatHour(order.order_hour)}
                  </span>
                )}
              </div>
            </div>
            <button className="mclose" onClick={handleClose}>×</button>
          </div>

          <div className="mbody">
            {/* Info summary */}
            <div style={{ background: 'var(--vc)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 14, display: 'grid', gridTemplateColumns: 'max-content 1fr max-content 1fr', gap: '6px 12px', fontSize: 13, alignItems: 'center' }}>
              <span style={{ color: 'var(--gt)', fontWeight: 600 }}>Hora:</span><strong>{formatHour(order.order_hour)}</strong>
              <span style={{ color: 'var(--gt)', fontWeight: 600 }}>Estado:</span><strong>{STATUS_LABEL[order.status] ?? order.status}</strong>
              <span style={{ color: 'var(--gt)', fontWeight: 600 }}>Canal:</span><strong>{order.channel === 'whatsapp' ? 'WhatsApp' : 'Llamada'}</strong>
              <span style={{ color: 'var(--gt)', fontWeight: 600 }}>Pago:</span><strong style={{ color: order.paid ? 'var(--v)' : '#DC2626' }}>{order.paid ? 'Pagado' : 'Pendiente'}</strong>
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
                  {canManage && (
                    <div><span style={{ color: 'var(--gt)' }}>Vuelto: </span><strong>{fmtCOP(Number(order.change_amount ?? 0))}</strong></div>
                  )}
                </div>
              </div>
            )}

            {!locked && diaCerrado && (
              <div style={{ background: 'var(--gm)', border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', padding: '12px 14px', marginBottom: 14, fontSize: 13, color: 'var(--gt)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Lock size={15} /> Este día ya fue cerrado - vista de solo lectura.
              </div>
            )}

            {!readOnly && (
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
                <input className="fi2" disabled={readOnly} value={nombre}
                  onChange={(e) => { setNombre(e.target.value); markDirty(); }} />
              </div>
              <div className="fg2">
                <label className="fl2">Teléfono</label>
                {/* Always disabled, even when the rest of the order is editable - this
                    is the real WhatsApp number the conversation is on, never a value
                    staff types in, and the backend no longer accepts changes to it
                    (see orders.ts's updateOrderSchema). */}
                <input className="fi2" disabled value={formatPhoneDisplay(telefono)} title="El teléfono no se puede modificar - es el número de WhatsApp del ticket" />
              </div>
            </div>
            <div className="fg2">
              <label className="fl2">Dirección</label>
              <input className="fi2" disabled={readOnly} value={direccion}
                onChange={(e) => { setDireccion(e.target.value); markDirty(); }} />
            </div>
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Método de pago</label>
                <select className="fi2" disabled={readOnly} value={pago}
                  onChange={(e) => { setPago(e.target.value); markDirty(); }}>
                  <option value="sin_asignar">Sin asignar</option>
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Pagado en tienda</option>
                  <option value="cod">Cobro en casa</option>
                </select>
              </div>
              <div className="fg2">
                <label className="fl2">Domiciliario</label>
                <select className="fi2" disabled={readOnly} value={empleadoId}
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
              locked={readOnly}
              onChange={(it) => { setItems(it); markDirty(); }}
              onLocalDirty={setCatalogDirty}
              clearKey={catalogClearKey}
            />

            {/* History - visible to whoever can manage this order */}
            {canManage && order.history && order.history.length > 0 && (
              <div>
                <div className={`hist-toggle${showHist ? ' open' : ''}`} onClick={() => setShowHist(!showHist)}>
                  <ChevronDown size={16} style={{ transition: 'transform .2s', transform: showHist ? 'rotate(180deg)' : 'none' }} />
                  Historial de cambios
                  <span style={{ background: 'var(--v)', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 800, marginLeft: 'auto' }}>
                    {order.history.length}
                  </span>
                </div>
                {showHist && (
                  <div style={{ marginBottom: 14 }}>
                    <HistoryTable history={order.history} />
                  </div>
                )}
              </div>
            )}

            <div className="mactions" style={{ flexWrap: 'wrap' }}>
              {!readOnly && canManage && order.status !== 'papelera' && (
                <button className="bdel"
                  onClick={() => setConfirmDlg({ msg: '¿Mover este pedido a la papelera?', onOk: () => papeleraMut.mutate(), danger: true })}
                  disabled={papeleraMut.isPending}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Trash2 size={13} /> Papelera
                </button>
              )}
              {!readOnly && (
                <button className="bpri"
                  onClick={() => {
                    if (items.length === 0) { toast('El pedido debe tener al menos un producto', true); return; }
                    saveMut.mutate();
                  }}
                  disabled={saveMut.isPending || !(isDirty || catalogDirty)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: (isDirty || catalogDirty) ? 1 : 0.5 }}>
                  <CheckCircle size={13} /> {saveMut.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              )}
              {items.length > 0 && (
                <button className="bsec" onClick={copyInvoice}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <FileText size={13} /> Copiar
                </button>
              )}
              {items.length > 0 && (
                <button className="bsec" onClick={generatePDF}
                  style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <FileText size={13} /> PDF
                </button>
              )}
              {items.length > 0 && order.ticket_id && (
                <button className="bsec" onClick={sendInvoiceToChat}
                  disabled={invoiceMut.isPending}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, borderColor: 'var(--v)', color: 'var(--v)' }}>
                  <Send size={13} /> {invoiceMut.isPending ? 'Enviando...' : 'Enviar factura'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CONFIRM DIALOG */}
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.msg}
          danger={confirmDlg.danger}
          cancelLabel={confirmDlg.onSave ? 'Salir' : 'Cancelar'}
          onSave={confirmDlg.onSave}
          savePending={saveMut.isPending}
          onConfirm={() => { confirmDlg.onOk(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}

      {/* COBRO DIALOG */}
      {showCobro && (
        <div className="moverlay on" style={{ zIndex: 700 }}>
          <div className="cobrobox">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <Banknote size={32} color="var(--v)" strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}>Confirmar pago</div>
            <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--gt)', marginBottom: 16 }}>
              {order.customer_name} - Total: <strong>{fmtCOP(total)}</strong>
            </div>
            <div style={{ background: 'var(--ac)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--a)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} /> Una vez confirmado, el pedido quedará bloqueado.
            </div>
            {cierreMissing.length > 0 && (
              <div style={{ background: 'var(--rc)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--r)', fontWeight: 700, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Falta completar antes de cerrar: {cierreMissing.join(', ')}.</span>
              </div>
            )}
            <div className="fg2">
              <label className="fl2">¿Quién recibió el pago?</label>
              <div className="fi2" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--gm)', cursor: 'default' }}>
                {user?.name ?? 'Usuario actual'}
              </div>
            </div>
            <div className="fg2">
              <label className="fl2">¿Cuánto se recibió? <span style={{ color: 'var(--r)', fontWeight: 800 }}>*</span></label>
              <input className="fi2 no-spin" type="number" placeholder={`Mínimo: $${total.toLocaleString('es-CO')}`}
                value={cobroRec} onChange={(e) => setCobroRec(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && cobroValido && !cobroMut.isPending) { e.preventDefault(); cobroMut.mutate(); } }}
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
            <div className="fg2" style={{ marginTop: 12 }}>
              <label className="fl2" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Lock size={13} /> Tu contraseña para confirmar <span style={{ color: 'var(--r)', fontWeight: 800 }}>*</span>
              </label>
              <PasswordInput className="fi2" placeholder="Contraseña de tu sesión"
                value={cobroPass} onChange={(e) => setCobroPass(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && cobroValido && !cobroMut.isPending) { e.preventDefault(); cobroMut.mutate(); } }}
                autoComplete="current-password" />
              <div style={{ fontSize: 12, color: 'var(--gt)', marginTop: 4 }}>
                Requerida para evitar cobros no autorizados
              </div>
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
              <button className="bsec" onClick={onClose}>Cancelar</button>
              <button className="bpri" onClick={() => cobroMut.mutate()}
                disabled={cobroMut.isPending || !cobroValido}
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
