import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, Send, Eye, ClipboardList, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { STATUS_LABEL, fmtCOP } from '../../lib/format';
import { toast } from '../ui/Toast';

// Safe URL regex — no backtracking ambiguity, no ReDoS risk
const URL_RE = /(https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]{1,2000})/g;
function renderText(text: string) {
  const parts = text.split(URL_RE);
  // Reset lastIndex since split reuses the regex object
  URL_RE.lastIndex = 0;
  return parts.map((p, i) => {
    URL_RE.lastIndex = 0;
    return URL_RE.test(p)
      ? <a key={i} href={p} target="_blank" rel="noreferrer noopener"
          style={{ color: '#1A7A4A', textDecoration: 'underline', wordBreak: 'break-all' }}>{p}</a>
      : p;
  });
}

interface Props {
  onCreateFromTicket: (ticket: any) => void;
  onOpenOrder: (orderId: string) => void;
}

export default function InboxPanel({ onCreateFromTicket, onOpenOrder }: Props) {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: tickets = [] } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<{ data: any[] }>('/inbox').then((r) => r.data),
    refetchInterval: 60000,
  });


  // Real-time: reorder sidebar + refresh open conversation on any message
  useEffect(() => {
    if (!accessToken) return;
    const sock = getSocket(accessToken);
    const onMsg = (data: { ticketId: string }) => {
      // Always refresh sidebar list (reorders by last_message_at)
      qc.invalidateQueries({ queryKey: ['inbox'] });
      // Refresh open conversation if it's the one that got the message
      if (data?.ticketId) {
        qc.invalidateQueries({ queryKey: ['inbox-convo', data.ticketId] });
      }
    };
    // Order status badges shown in the sidebar and the linked-orders bar must update
    // immediately when an order moves/changes elsewhere (e.g. dragged in the swimlane),
    // not just when a new chat message happens to trigger a refetch.
    const onOrderChange = () => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['inbox-convo'] });
    };
    sock.on('ticket:message', onMsg);
    sock.on('order:moved', onOrderChange);
    sock.on('order:updated', onOrderChange);
    sock.on('order:paid', onOrderChange);
    return () => {
      sock.off('ticket:message', onMsg);
      sock.off('order:moved', onOrderChange);
      sock.off('order:updated', onOrderChange);
      sock.off('order:paid', onOrderChange);
    };
  }, [accessToken, qc]);

  const { data: conversation, isLoading: loadingConvo } = useQuery({
    queryKey: ['inbox-convo', selectedId],
    queryFn: () =>
      selectedId
        ? api.get<{ data: any }>(`/inbox/${selectedId}/messages`).then((r) => r.data)
        : null,
    enabled: !!selectedId,
  });

  const replyMut = useMutation({
    mutationFn: (text: string) => api.post<{ data: any; wpp_status: string; wpp_error?: string }>(`/inbox/${selectedId}/reply`, { text }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['inbox-convo', selectedId] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      setReplyText('');
      if (res?.wpp_status === 'failed') {
        toast(`Mensaje guardado pero falló el envío a WhatsApp: ${res.wpp_error ?? 'error Meta API'}`, true);
      } else if (res?.wpp_status === 'no_credentials') {
        toast('Mensaje guardado. WPP sin configurar - revisa DevTools - WPP', true);
      }
    },
    onError: (e: any) => toast(e.message, true),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages?.length, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const handler = (e: Event) => { if ((e as globalThis.KeyboardEvent).key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  }

  function sendReply() {
    const txt = replyText.trim();
    if (!txt || replyMut.isPending) return;
    replyMut.mutate(txt);
  }

  function formatMsgTime(raw: string) {
    return new Date(raw).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  function formatSidebarTime(raw: string) {
    const d = new Date(raw);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  const selectedTicket = tickets.find((t: any) => t.id === selectedId);

  return (
    <div className="inbox-wrap">
      {/* LEFT SIDEBAR */}
      <div className="inbox-sidebar">
        <div style={{ padding: '12px 16px', borderBottom: '2px solid var(--brd)', background: 'var(--vc)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 14, color: 'var(--vd)' }}>
            <MessageSquare size={16} /> Conversaciones WPP
          </div>
          <div style={{ fontSize: 12, color: 'var(--gt)', marginTop: 3 }}>
            {tickets.length} chat{tickets.length !== 1 ? 's' : ''} · historial completo
          </div>
        </div>

        {tickets.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--gt)', fontSize: 13 }}>
            Sin conversaciones
          </div>
        )}

        {(tickets as any[]).map((t) => {
          const lastMsg = t.messages?.[0];
          const ordCount = t.orders?.length ?? 0;
          return (
            <div
              key={t.id}
              className={`inbox-item${selectedId === t.id ? ' sel' : ''}`}
              onClick={() => setSelectedId(t.id)}
            >
              <div className="inbox-item-head">
                <span className="inbox-item-name">{t.customer_name || t.phone}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {t.unread_count > 0 && (
                    <span className="inbox-unread">{t.unread_count}</span>
                  )}
                  <span className="inbox-item-time">
                    {t.last_message_at ? formatSidebarTime(t.last_message_at) : ''}
                  </span>
                </div>
              </div>
              <div className="inbox-item-phone">{t.phone}</div>
              {lastMsg && (
                <div className="inbox-item-preview">
                  {lastMsg.direction === 'out' ? '› ' : ''}{lastMsg.text}
                </div>
              )}
              {ordCount > 0 && (
                <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(t.orders as any[]).map((o: any) => (
                    <span key={o.id} style={{
                      fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 8,
                      background: o.paid ? 'var(--vc)' : 'var(--gm)',
                      color: o.paid ? 'var(--vd)' : 'var(--gt)',
                    }}>
                      #{o.num} · {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* RIGHT CHAT PANEL */}
      {!selectedId ? (
        <div className="inbox-chat">
          <div className="inbox-empty">
            <MessageSquare size={48} color="#ccc" strokeWidth={1} />
            <div className="inbox-no-sel">Selecciona una conversación</div>
          </div>
        </div>
      ) : (
        <div className="inbox-chat">
          {/* Chat header */}
          <div className="inbox-chat-head">
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                {selectedTicket?.customer_name || selectedTicket?.phone}
              </div>
              <div style={{ fontSize: 13, color: 'var(--gt)' }}>{selectedTicket?.phone}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedId && (
                <button className="bsec" style={{ padding: '8px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                  title="Enviar formulario de pedido al cliente"
                  onClick={async () => {
                    try {
                      const res = await api.get<{ data: { url: string } }>(`/inbox/${selectedId}/form-link`);
                      replyMut.mutate(res.data.url);
                    } catch { toast('No se pudo generar el link', true); }
                  }}>
                  <ClipboardList size={13} /> Lista
                </button>
              )}
              <button className="bnew" style={{ padding: '8px 14px', fontSize: 13 }}
                onClick={() => selectedTicket && onCreateFromTicket(selectedTicket)}>
                <Plus size={13} strokeWidth={3} />
                {(selectedTicket?.orders?.length ?? 0) > 0 ? 'Otro pedido' : 'Crear pedido'}
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="inbox-messages">
            {loadingConvo && (
              <div style={{ textAlign: 'center', color: '#667781', padding: 20, fontSize: 13 }}>
                Cargando mensajes...
              </div>
            )}

            {conversation?.messages?.map((msg: any, i: number) => {
              const isOut = msg.direction === 'out';
              const prevMsg = conversation.messages[i - 1];
              const showDate = !prevMsg ||
                new Date(msg.sent_at).toDateString() !== new Date(prevMsg.sent_at).toDateString();

              return (
                <div key={msg.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  {showDate && (
                    <div className="chat-sep">
                      {new Date(msg.sent_at).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </div>
                  )}
                  <div className={`chat-bub ${isOut ? 'out' : 'in'}`}>
                    {isOut && msg.sender?.name && (
                      <div className="chat-bub-who">{msg.sender.name}</div>
                    )}
                    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderText(msg.text)}</div>
                    <div className="chat-bub-time">{formatMsgTime(msg.sent_at)}</div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Linked orders bar */}
          {conversation?.orders && conversation.orders.length > 0 && (
            <div className="inbox-orders-bar">
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--vd)', marginRight: 4 }}>
                Pedidos:
              </span>
              {(conversation.orders as any[]).map((o: any) => {
                const total = (o.items ?? []).reduce((s: number, i: any) => s + Number(i.price), 0);
                return (
                  <button key={o.id} onClick={() => onOpenOrder(o.id)}
                    style={{
                      background: o.paid ? 'var(--vd)' : 'var(--v)',
                      color: '#fff', border: 'none', borderRadius: 8,
                      padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}>
                    <Eye size={11} />
                    #{o.num} · {STATUS_LABEL[o.status] ?? o.status} · {fmtCOP(total)}
                    {o.paid && <Check size={11} style={{ marginLeft: 3 }} />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Reply bar */}
          <div className="inbox-reply">
            <textarea
              placeholder="Escribe un mensaje... (Enter para enviar, Shift+Enter para salto)"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button className="send-btn" onClick={sendReply} disabled={!replyText.trim() || replyMut.isPending}>
              <Send size={16} style={{ display: 'inline', verticalAlign: 'middle' }} />
              {' '}Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
