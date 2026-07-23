import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect, useState, KeyboardEvent } from 'react';
import { Check, SendHorizontal, ArrowRight, Lock, ClipboardList, Ban } from 'lucide-react';
import DeliveryStatus from '../ui/DeliveryStatus';
import { api } from '../../lib/api';
import { buildFormLinkMessage } from '../../lib/formLinkMessage';
import { formatPhoneDisplay } from '../../lib/formatPhone';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { fmtCOP, STATUS_LABEL, todayStr } from '../../lib/format';
import { useDiaCerrado } from '../../hooks/useCierre';
import { useWithinFormHours, FORM_HOURS_CLOSED_MSG } from '../../hooks/useFormHours';
import { toast } from '../ui/Toast';
import { ConfirmModal } from '../ui/ConfirmModal';

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
  ticketId: string;
  fecha: string;
  onClose: () => void;
  onCreateFromTicket?: (ticket: any) => void;
  onOpenOrder?: (orderId: string) => void;
}

export default function TicketModal({ ticketId, fecha, onClose, onCreateFromTicket, onOpenOrder }: Props) {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [reply, setReply] = useState('');
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  // Orders shown here must be scoped to the day currently being viewed on the board
  // (fecha), not every order this ticket ever had - opening today's chat for a
  // customer who also ordered yesterday must not show yesterday's pedido here.
  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', ticketId, fecha],
    queryFn: () => api.get<{ data: any }>(`/inbox/${ticketId}/messages?fecha=${fecha}`).then((r) => r.data),
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!accessToken) return;
    const sock = getSocket(accessToken);
    const onMsg = (data: { ticketId: string }) => {
      if (data?.ticketId === ticketId) qc.invalidateQueries({ queryKey: ['ticket', ticketId, fecha] });
    };
    // Delivery/read/failure updates on a message already shown here - same
    // invalidate-and-refetch as a new message, just a different trigger.
    const onMsgStatus = (data: { ticketId: string }) => {
      if (data?.ticketId === ticketId) qc.invalidateQueries({ queryKey: ['ticket', ticketId, fecha] });
    };
    // Orders embedded in this ticket's card list must reflect status/paid changes
    // immediately, not just when a new chat message happens to trigger a refetch.
    const onOrderChange = () => qc.invalidateQueries({ queryKey: ['ticket', ticketId, fecha] });
    sock.on('ticket:message', onMsg);
    sock.on('ticket:message-status', onMsgStatus);
    sock.on('order:moved', onOrderChange);
    sock.on('order:updated', onOrderChange);
    sock.on('order:paid', onOrderChange);
    return () => {
      sock.off('ticket:message', onMsg);
      sock.off('ticket:message-status', onMsgStatus);
      sock.off('order:moved', onOrderChange);
      sock.off('order:updated', onOrderChange);
      sock.off('order:paid', onOrderChange);
    };
  }, [accessToken, ticketId, qc]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [ticket?.messages?.length]);

  const sendMut = useMutation({
    mutationFn: () => api.post<{ data: any; wpp_status: string; wpp_error?: string }>(`/inbox/${ticketId}/reply`, { text: reply }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId, fecha] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      setReply('');
      // e.g. outside Meta's 24h customer-service window - the message still saves
      // and shows in the chat, so without this staff has no way to know it never
      // actually reached the client's WhatsApp.
      if (res?.wpp_status === 'failed') {
        toast(`Mensaje guardado pero falló el envío a WhatsApp: ${res.wpp_error ?? 'error Meta API'}`, true);
      } else if (res?.wpp_status === 'no_credentials') {
        toast('Mensaje guardado, pero este negocio no tiene WhatsApp conectado', true);
      } else {
        toast('Mensaje enviado');
      }
    },
    onError: (e: any) => toast(e.message, true),
  });

  const formLinkMut = useMutation({
    mutationFn: (text: string) => api.post(`/inbox/${ticketId}/reply`, { text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      toast('Formulario enviado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  async function sendFormLink() {
    try {
      const res = await api.get<{ data: { url: string } }>(`/inbox/${ticketId}/form-link`);
      formLinkMut.mutate(buildFormLinkMessage(res.data.url));
    } catch {
      toast('No se pudo generar el link', true);
    }
  }

  const blockLinkMut = useMutation({
    mutationFn: () => api.post(`/inbox/${ticketId}/form-link/revoke`, {}),
    onSuccess: () => toast('Link bloqueado - el cliente ya no puede usarlo'),
    onError: (e: any) => toast(e.message ?? 'No se pudo bloquear el link', true),
  });

  const activeOrders = (ticket?.orders ?? []).filter((o: any) => o.status !== 'papelera');
  const hasOrders = activeOrders.length > 0;
  // The link itself already expires (end of the Colombia calendar day it was sent, or
  // sooner - see inbox.ts's /form-link route) - viewing a past day's chat here means
  // whatever link was ever sent for it is already dead, so sending/blocking one from
  // this stale view can only confuse ("bloqueado" a link that already expired, or a
  // fresh link that's really meant for TODAY's conversation, not the day being read).
  // Also true the moment TODAY's caja gets closed early (cierre.ts only allows
  // closing today), same as a past day for this purpose.
  const { data: cierreStatus } = useDiaCerrado(fecha);
  const isPastDay = fecha < todayStr() || (cierreStatus?.cerrado ?? false);
  const withinFormHours = useWithinFormHours();

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        display: 'flex', flexDirection: 'row',
        width: '100%', maxWidth: 860,
        margin: 'auto', borderRadius: 'var(--radb)',
        overflow: 'hidden', boxShadow: 'var(--shf)',
        animation: 'mup .2s ease', maxHeight: '90vh',
      }}>

        {/* ===== LEFT: CHAT ===== */}
        <div style={{
          width: 310, background: '#ECE5DD', display: 'flex',
          flexDirection: 'column', flexShrink: 0, minHeight: 0,
        }}>
          {/* Chat header */}
          <div style={{ background: 'var(--vd)', color: '#fff', padding: '14px 16px', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {isLoading ? 'Cargando...' : ticket?.customer_name}
              </div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {formatPhoneDisplay(ticket?.phone)}
                {ticket?.messages?.length != null && ` · ${ticket.messages.length} mensajes`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
              <button
                className="hdr-ic-btn"
                title={isPastDay ? 'Este chat es de un día anterior - el link ya expiró' : !withinFormHours ? FORM_HOURS_CLOSED_MSG : 'Enviar formulario de pedido al cliente'}
                onClick={sendFormLink}
                disabled={formLinkMut.isPending || isPastDay || !withinFormHours}
              >
                <ClipboardList size={13} />
                Formulario
              </button>
              <button
                className="hdr-ic-btn"
                title={isPastDay ? 'Este chat es de un día anterior - el link ya expiró' : !withinFormHours ? FORM_HOURS_CLOSED_MSG : 'Bloquear el link de formulario enviado a este cliente'}
                onClick={() => setShowBlockConfirm(true)}
                disabled={blockLinkMut.isPending || isPastDay || !withinFormHours}
              >
                <Ban size={13} />
                <span>Bloquear<br />Link</span>
              </button>
            </div>
          </div>

          {/* Messages - scrollable */}
          <div ref={chatRef} style={{
            flex: 1, overflowY: 'auto', padding: '10px',
            display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0,
          }}>
            {(ticket?.messages ?? []).map((msg: any, i: number) => {
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
                    <div style={{ fontSize: 10, color: '#999', textAlign: 'right', marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      {new Date(msg.sent_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}
                      {isOut && msg.wpp_message_id && (
                        <DeliveryStatus delivered={msg.delivered} read_by_client={msg.read_by_client} failed_reason={msg.failed_reason} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {!isLoading && (!ticket?.messages || ticket.messages.length === 0) && (
              <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: 16 }}>Sin mensajes</div>
            )}
          </div>

          {/* Reply bar */}
          <div style={{
            background: '#F0F2F0', padding: '8px 10px',
            display: 'flex', gap: 6, alignItems: 'flex-end',
            borderTop: '1px solid #D0D8D0', flexShrink: 0,
          }}>
            <textarea
              rows={2}
              placeholder="Escribe un mensaje... (Enter para enviar)"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!sendMut.isPending && reply.trim()) sendMut.mutate();
                }
              }}
              style={{
                flex: 1, resize: 'none', border: '1.5px solid var(--brd)',
                borderRadius: 10, padding: '7px 10px', fontSize: 12,
                fontFamily: 'inherit', background: '#fff', outline: 'none',
              }}
            />
            <button
              onClick={() => { if (reply.trim() && !sendMut.isPending) sendMut.mutate(); }}
              disabled={!reply.trim() || sendMut.isPending}
              style={{
                background: reply.trim() ? 'var(--v)' : 'var(--gm)',
                border: 'none', borderRadius: 10, padding: '8px 10px',
                cursor: reply.trim() ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background .15s', flexShrink: 0,
              }}
            >
              <SendHorizontal size={15} color={reply.trim() ? '#fff' : 'var(--gt)'} />
            </button>
          </div>
        </div>

        {/* ===== RIGHT: ORDERS ===== */}
        <div className="mwin" style={{
          margin: 0, flex: 1, minWidth: 0,
          borderRadius: '0 var(--radb) var(--radb) 0',
          boxShadow: 'none', maxHeight: '90vh',
        }}>
          <div className="mhead" style={{ borderRadius: '0 var(--radb) 0 0' }}>
            <div>
              <div className="mtit">{isLoading ? 'Cargando...' : ticket?.customer_name}</div>
              <div className="msub">
                {hasOrders ? `${activeOrders.length} pedido${activeOrders.length !== 1 ? 's' : ''} de esta fecha` : 'Sin pedidos en esta fecha'}
              </div>
            </div>
            <button className="mclose" onClick={onClose}>×</button>
          </div>

          <div className="mbody">
            {hasOrders ? (
              <div style={{ marginBottom: 4 }}>
                {activeOrders.map((o: any) => {
                  const total = o.items?.reduce((s: number, i: any) => s + Number(i.price), 0) ?? 0;
                  return (
                    <div key={o.id} className="tk-ord-card">
                      <div className="tk-ord-label">Pedido de despacho #{o.num}</div>
                      <div className="tk-ord-grid">
                        <span style={{ color: 'var(--gt)' }}>Estado</span>
                        <span style={{ fontWeight: 800 }}>{STATUS_LABEL[o.status] ?? o.status}</span>
                        <span style={{ color: 'var(--gt)' }}>Total</span>
                        <span style={{ fontWeight: 800, color: 'var(--v)' }}>{fmtCOP(total)}</span>
                        <span style={{ color: 'var(--gt)' }}>Domiciliario</span>
                        <span style={{ fontWeight: 700 }}>{o.employee?.name ?? 'Sin asignar'}</span>
                        <span style={{ color: 'var(--gt)' }}>Pago</span>
                        <span style={{ fontWeight: 800, color: o.paid ? '#2E7D32' : 'var(--a)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {o.paid ? <><Check size={12} strokeWidth={3} /> Cobrado</> : 'Pendiente'}
                        </span>
                      </div>
                      {onOpenOrder && (
                        <button className="bverde" style={{ width: '100%', marginTop: 9, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          onClick={() => { onClose(); onOpenOrder(o.id); }}>
                          Ver pedido #{o.num} <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                background: 'var(--ac)', border: '2px solid #FFCC80',
                borderRadius: 'var(--rad)', padding: '14px 16px', fontSize: 14,
                color: 'var(--a)', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Lock size={14} /> Este ticket aún no tiene pedido. El cliente está esperando atención.
              </div>
            )}

            <div className="mactions">
              <button className="bsec" onClick={onClose}>Cerrar</button>
              {onCreateFromTicket && (
                <button className="bpri"
                  onClick={() => { onClose(); onCreateFromTicket(ticket); }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  + {hasOrders ? 'Otro pedido' : 'Crear pedido'}
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

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
