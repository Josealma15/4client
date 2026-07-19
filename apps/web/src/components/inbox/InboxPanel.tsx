import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { getSocket } from '../../lib/socket';
import { toast } from '../ui/Toast';
import { colombiaDateStr } from '../../lib/format';

// Safe URL regex - no backtracking ambiguity, no ReDoS risk
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

// Messages only - viewing and replying. Creating/opening pedidos from a chat happens
// in "Ver conversación" (TicketModal), not here.
export default function InboxPanel() {
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
    // Fallback only - real-time delivery is via socket, but a missed/late socket event
    // (reconnect race, room not rejoined yet) shouldn't leave the open conversation stale
    // for longer than this.
    refetchInterval: 60000,
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
    return new Date(raw).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
  }

  function formatSidebarTime(raw: string) {
    const d = new Date(raw);
    if (colombiaDateStr(d) === colombiaDateStr()) {
      return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
    }
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
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
                colombiaDateStr(msg.sent_at) !== colombiaDateStr(prevMsg.sent_at);

              return (
                <div key={msg.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  {showDate && (
                    <div className="chat-sep">
                      {new Date(msg.sent_at).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' })}
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
