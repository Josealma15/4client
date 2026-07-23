import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Smartphone, Check, Send, ClipboardList, Ban } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useProducts } from '../../hooks/useProducts';
import { buildFormLinkMessage } from '../../lib/formLinkMessage';
import { formatPhoneDisplay } from '../../lib/formatPhone';
import { useEmployees } from '../../hooks/useEmployees';
import { useCreateOrder } from '../../hooks/useOrders';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { toast } from '../ui/Toast';
import { ConfirmModal } from '../ui/ConfirmModal';
import ProductSearch from '../orders/ProductSearch';
import { todayStr } from '../../lib/format';
import { useDiaCerrado } from '../../hooks/useCierre';
import { useWithinFormHours, FORM_HOURS_CLOSED_MSG } from '../../hooks/useFormHours';

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

interface Props {
  fecha: string;
  onClose: () => void;
  ticketId?: string;
  preNombre?: string;
  prePhone?: string;
  messages?: { text: string; direction: string; created_at?: string }[];
}

export default function NuevoPedidoModal({ fecha, onClose, ticketId, preNombre, prePhone, messages: initialMessages }: Props) {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const { data: products = [] } = useProducts();
  const { data: employees = [] } = useEmployees();
  const createOrder = useCreateOrder();

  const [canal, setCanal] = useState('whatsapp');
  const [pago, setPago] = useState('sin_asignar');
  const [nombre, setNombre] = useState(preNombre ?? '');
  // Display-only, from the ticket's real WhatsApp number - never user-editable
  // (see the disabled input below), so no setter needed.
  const [telefono] = useState(prePhone ?? '');
  const [direccion, setDireccion] = useState('');
  const [empleadoId, setEmpleadoId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [replyText, setReplyText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Live chat data from API
  const { data: convoData } = useQuery({
    queryKey: ['inbox-convo', ticketId],
    queryFn: () => api.get<{ data: any }>(`/inbox/${ticketId}/messages`).then((r) => r.data),
    enabled: !!ticketId,
    refetchInterval: 60000, // fallback only - real-time delivery is via socket below
  });

  // This modal never had a socket listener at all, only the interval above - meaning a
  // message arriving while it's open could sit unseen for up to 15-60s. Same pattern as
  // TicketModal/DetallePedidoModal.
  useEffect(() => {
    if (!accessToken || !ticketId) return;
    const sock = getSocket(accessToken);
    const onMsg = (data: { ticketId: string }) => {
      if (data?.ticketId === ticketId) qc.invalidateQueries({ queryKey: ['inbox-convo', ticketId] });
    };
    sock.on('ticket:message', onMsg);
    return () => { sock.off('ticket:message', onMsg); };
  }, [accessToken, ticketId, qc]);

  const liveMessages: any[] = convoData?.messages ?? initialMessages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveMessages.length]);

  const replyMut = useMutation({
    mutationFn: (text: string) => api.post(`/inbox/${ticketId}/reply`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', ticketId] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      setReplyText('');
    },
    onError: (e: any) => toast(e.message ?? 'Error al enviar', true),
  });

  const blockLinkMut = useMutation({
    mutationFn: () => api.post(`/inbox/${ticketId}/form-link/revoke`, {}),
    onSuccess: () => toast('Link bloqueado - el cliente ya no puede usarlo'),
    onError: (e: any) => toast(e.message ?? 'No se pudo bloquear el link', true),
  });
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  function handleSend() {
    if (!replyText.trim() || replyMut.isPending) return;
    replyMut.mutate(replyText.trim());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasDirty = nombre.trim() !== (preNombre ?? '').trim()
    || telefono.trim() !== (prePhone ?? '').trim()
    || direccion.trim() !== ''
    || items.length > 0;
  const [confirmDlg, setConfirmDlg] = useState<{ msg: string; onOk: () => void; onSave?: () => void } | null>(null);

  function handleClose() {
    if (hasDirty) {
      setConfirmDlg({
        msg: 'Hay datos sin guardar.',
        onOk: onClose,
        onSave: () => { handleSubmit(); setConfirmDlg(null); },
      });
      return;
    }
    onClose();
  }

  async function handleSubmit() {
    if (!ticketId) { toast('El pedido debe crearse desde un ticket de WhatsApp', true); return; }
    if (!nombre.trim()) { toast('El nombre es obligatorio', true); return; }
    if (items.length === 0) { toast('Agrega al menos un producto', true); return; }
    try {
      await createOrder.mutateAsync({
        fecha,
        ticket_id: ticketId,
        channel: canal,
        payment_method: pago,
        customer_name: nombre.trim(),
        // No customer_phone - this modal always requires a ticketId (checked above),
        // and the backend always sets the phone from that ticket's real WhatsApp
        // number, never from a typed value (orders.ts's POST /).
        address: direccion.trim() || undefined,
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

  const hasChat = !!ticketId;
  // Same reasoning as TicketModal/DetallePedidoModal - the link itself already
  // expires by end of the Colombia day it was sent, so a past day's ticket has
  // nothing live to send/block. Also true the moment TODAY's caja gets closed early.
  const { data: cierreStatus } = useDiaCerrado(fecha);
  const isPastDay = fecha < todayStr() || (cierreStatus?.cerrado ?? false);
  const withinFormHours = useWithinFormHours();

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div style={{
        display: 'flex', flexDirection: 'row', width: '100%',
        maxWidth: hasChat ? 960 : 700,
        margin: 'auto', borderRadius: 'var(--radb)',
        overflow: 'hidden', boxShadow: 'var(--shf)',
        animation: 'mup .2s ease', maxHeight: '90vh',
      }}>
        {hasChat && (
          <div style={{ width: 300, background: '#ECE5DD', display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0 }}>
            <div style={{ background: 'var(--vd)', color: '#fff', padding: '10px 12px', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Smartphone size={15} />
              <span style={{ flex: 1 }}>{preNombre || formatPhoneDisplay(telefono)}</span>
              {ticketId && (
                <button
                  className="hdr-ic-btn"
                  title={isPastDay ? 'Este ticket es de un día anterior - el link ya expiró' : !withinFormHours ? FORM_HOURS_CLOSED_MSG : 'Enviar formulario de pedido al cliente'}
                  disabled={isPastDay || !withinFormHours}
                  onClick={async () => {
                    try {
                      const res = await api.get<{ data: { url: string } }>(`/inbox/${ticketId}/form-link`);
                      replyMut.mutate(buildFormLinkMessage(res.data.url));
                    } catch { toast('No se pudo generar el link', true); }
                  }}
                >
                  <ClipboardList size={13} />
                  Formulario
                </button>
              )}
              {ticketId && (
                <button
                  className="hdr-ic-btn"
                  title={isPastDay ? 'Este ticket es de un día anterior - el link ya expiró' : !withinFormHours ? FORM_HOURS_CLOSED_MSG : 'Bloquear el link de formulario enviado a este cliente'}
                  onClick={() => setShowBlockConfirm(true)}
                  disabled={blockLinkMut.isPending || isPastDay || !withinFormHours}
                >
                  <Ban size={13} />
                  <span>Bloquear<br />Link</span>
                </button>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {liveMessages.map((m: any, i: number) => (
                <div key={i} className={`chat-msg ${m.direction === 'out' ? 'us' : 'them'}`}>
                  <div className="chat-bubble" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderText(m.text)}</div>
                  {(m.sent_at || m.created_at) && (
                    <div className="chat-meta">
                      {new Date(m.sent_at ?? m.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            {/* Reply input */}
            <div style={{ background: '#F0F2F0', padding: '8px 10px', display: 'flex', gap: 6, alignItems: 'flex-end', borderTop: '1px solid #D0D8D0' }}>
              <textarea
                rows={2}
                placeholder="Escribe un mensaje... (Enter para enviar)"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{
                  flex: 1, resize: 'none', border: '1.5px solid var(--brd)',
                  borderRadius: 10, padding: '7px 10px', fontSize: 13,
                  fontFamily: 'var(--f)', background: '#fff', outline: 'none',
                }}
              />
              <button
                onClick={handleSend}
                disabled={!replyText.trim() || replyMut.isPending}
                style={{
                  background: replyText.trim() ? 'var(--v)' : 'var(--gm)',
                  border: 'none', borderRadius: 10, padding: '8px 10px',
                  cursor: replyText.trim() ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background .15s',
                }}
              >
                <Send size={16} color={replyText.trim() ? '#fff' : 'var(--gt)'} />
              </button>
            </div>
          </div>
        )}

        <div className="mwin" style={{
          margin: 0, flex: 1,
          borderRadius: hasChat ? '0 var(--radb) var(--radb) 0' : 'var(--radb)',
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
            <div className="fg2">
              <label className="fl2">Canal</label>
              <select className="fi2" value={canal} onChange={(e) => setCanal(e.target.value)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="call">Llamada</option>
              </select>
            </div>
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Nombre del cliente *</label>
                <input className="fi2" placeholder="Ej: María González" value={nombre}
                  onChange={(e) => setNombre(e.target.value)} />
              </div>
              <div className="fg2">
                <label className="fl2">Teléfono</label>
                {/* Always disabled - this modal only ever creates orders linked to a
                    ticket (handleSubmit blocks otherwise), and the backend always
                    takes the phone from that ticket's real WhatsApp number. */}
                <input className="fi2" disabled value={formatPhoneDisplay(telefono)} title="El teléfono es el número de WhatsApp del ticket - no se puede modificar" />
              </div>
            </div>
            <div className="fg2">
              <label className="fl2">Dirección de entrega <span style={{ fontWeight: 400, color: 'var(--gt)' }}>(opcional, requerida solo para cerrar el pedido)</span></label>
              <input className="fi2" placeholder="Ej: Cra 45 #12-34, Casa azul" value={direccion}
                onChange={(e) => setDireccion(e.target.value)} />
            </div>
            <div className="frow">
              <div className="fg2">
                <label className="fl2">Método de pago</label>
                <select className="fi2" value={pago} onChange={(e) => setPago(e.target.value)}>
                  <option value="sin_asignar">Sin asignar</option>
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Pagado en tienda</option>
                  <option value="cod">Cobro en casa</option>
                </select>
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
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.msg}
          cancelLabel={confirmDlg.onSave ? 'Salir' : 'Cancelar'}
          onSave={confirmDlg.onSave}
          savePending={createOrder.isPending}
          onConfirm={() => { confirmDlg.onOk(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
      {showBlockConfirm && (
        <ConfirmModal
          message="Vas a bloquear el link del formulario - el cliente no podrá usarlo y tendrás que enviarle uno nuevo. ¿Deseas bloquearlo?"
          confirmLabel="Bloquear"
          danger
          onConfirm={() => { blockLinkMut.mutate(); setShowBlockConfirm(false); }}
          onCancel={() => setShowBlockConfirm(false)}
        />
      )}
    </div>
  );
}
