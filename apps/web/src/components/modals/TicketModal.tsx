import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';

interface Props { ticketId: string; onClose: () => void; }

export default function TicketModal({ ticketId, onClose }: Props) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.get<{ data: any }>(`/inbox/${ticketId}/messages`).then((r) => r.data),
  });

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

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mwin">
        <div className="mhead">
          <div>
            <div className="mtit">{isLoading ? 'Cargando...' : ticket?.customer_name}</div>
            <div className="msub">{ticket?.phone}</div>
          </div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="mbody">
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--rad)', padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--gt)', fontWeight: 600 }}>
            🔒 Registro inmutable de la conversación de WhatsApp.
          </div>

          <div className="chat-outer">
            {(ticket?.messages ?? []).map((msg: any) => (
              <div key={msg.id} className={`chat-msg ${msg.direction === 'in' ? 'them' : 'us'}`}>
                <div className="chat-bubble">{msg.text}</div>
                <div className="chat-meta">
                  {msg.direction === 'out' && msg.sender?.name && `${msg.sender.name} · `}
                  {new Date(msg.sent_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>

          {ticket?.orders?.filter((o: any) => o.status !== 'papelera').length > 0 && (
            <div style={{ background: 'var(--vc)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--vd)', marginBottom: 6 }}>PEDIDOS VINCULADOS</div>
              {ticket.orders.filter((o: any) => o.status !== 'papelera').map((o: any) => (
                <div key={o.id} style={{ fontSize: 13, display: 'flex', gap: 8, padding: '3px 0' }}>
                  <strong>#{o.num}</strong>
                  <span style={{ color: 'var(--gt)' }}>{o.status}</span>
                  {o.paid && <span style={{ color: 'var(--v)', fontWeight: 700 }}>✓ Cobrado</span>}
                </div>
              ))}
            </div>
          )}

          <div className="mactions">
            <button className="bsec" onClick={onClose}>Cerrar</button>
            <div style={{ flex: 2, display: 'flex', gap: 8 }}>
              <input className="fi2" style={{ flex: 1 }} placeholder="Responder... (Fase 1C: Meta API)"
                value={reply} onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !sendMut.isPending && reply.trim() && sendMut.mutate()} />
              <button className="bpri" style={{ width: 'auto', margin: 0, padding: '0 18px' }}
                disabled={!reply.trim() || sendMut.isPending}
                onClick={() => sendMut.mutate()}>
                Enviar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
