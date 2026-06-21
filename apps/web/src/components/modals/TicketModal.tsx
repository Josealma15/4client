import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect, useState } from 'react';
import { Lock, Check, SendHorizontal, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtCOP, STATUS_LABEL } from '../../lib/format';
import { toast } from '../ui/Toast';

interface Props {
  ticketId: string;
  onClose: () => void;
  onCreateFromTicket?: (ticket: any) => void;
  onOpenOrder?: (orderId: string) => void;
}

export default function TicketModal({ ticketId, onClose, onCreateFromTicket, onOpenOrder }: Props) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.get<{ data: any }>(`/inbox/${ticketId}/messages`).then((r) => r.data),
  });

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [ticket?.messages]);

  const sendMut = useMutation({
    mutationFn: () => api.post(`/inbox/${ticketId}/reply`, { text: reply }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      setReply('');
      toast('Mensaje enviado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const activeOrders = (ticket?.orders ?? []).filter((o: any) => o.status !== 'papelera');
  const hasOrders = activeOrders.length > 0;

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mwin">
        <div className="mhead">
          <div>
            <div className="mtit">{isLoading ? 'Cargando...' : ticket?.customer_name}</div>
            <div className="msub">
              {ticket?.phone}
              {ticket?.messages?.length != null && ` · ${ticket.messages.length} mensajes`}
            </div>
          </div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="mbody">
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--rad)', padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--gt)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={12} /> Registro inmutable de la conversación de WhatsApp.
          </div>

          <div className="chat-outer" ref={chatRef}>
            <div className="chat-sep">Hoy</div>
            {(ticket?.messages ?? []).map((msg: any, i: number) => (
              <div key={msg.id ?? i} className={`chat-msg ${msg.direction === 'in' ? 'them' : 'us'}`}>
                <div className="chat-bubble">{msg.text}</div>
                <div className="chat-meta">
                  {msg.direction === 'out' && msg.sender?.name && `${msg.sender.name} · `}
                  {new Date(msg.sent_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>

          {hasOrders ? (
            <div style={{ marginBottom: 12 }}>
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
            <div style={{ background: 'var(--ac)', border: '2px solid #FFCC80', borderRadius: 'var(--rad)', padding: '12px 14px', marginBottom: 12, fontSize: 14, color: 'var(--a)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Lock size={14} /> Este ticket aún no tiene pedido. El cliente está esperando atención.
            </div>
          )}

          <div className="mactions">
            <button className="bsec" onClick={onClose}>Cerrar</button>
            <div style={{ flex: 2, display: 'flex', gap: 8 }}>
              <input className="fi2" style={{ flex: 1 }} placeholder="Responder... (Fase 1C: Meta API)"
                value={reply} onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !sendMut.isPending && reply.trim() && sendMut.mutate()} />
              <button className="bpri"
                style={{ width: 'auto', margin: 0, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 6 }}
                disabled={!reply.trim() || sendMut.isPending}
                onClick={() => sendMut.mutate()}>
                <SendHorizontal size={14} /> Enviar
              </button>
            </div>
          </div>
          {onCreateFromTicket && (
            <div style={{ marginTop: 8 }}>
              <button className="tk-crear-btn" onClick={() => { onClose(); onCreateFromTicket(ticket); }}>
                + {hasOrders ? 'Crear otro pedido' : 'Crear pedido de despacho'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
