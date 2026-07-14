import { useState, useRef, useEffect } from 'react';
import { Siren, MessageSquare, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Eye, Plus, AlertTriangle, Lock, Bell } from 'lucide-react';
import { STATUS_LABEL, STATUS_ORDER, fmtCOP, todayStr } from '../../lib/format';
import { useMoveOrder } from '../../hooks/useOrders';
import { toast } from '../ui/Toast';
import DetallePedidoModal from '../modals/DetallePedidoModal';

interface Ticket {
  id: string; phone: string; customer_name: string;
  unread_count: number; last_message_at: string; created_at: string;
  messages: { text: string; direction: string; created_at?: string }[];
  orders: { id: string; num: string; status: string; paid: boolean }[];
}

interface Order {
  id: string; num: string; customer_name: string; status: string;
  paid: boolean; locked: boolean; payment_method: string;
  address: string; employee?: { name: string };
  items: { product_name?: string; quantity_label?: string; price: number }[];
  ticket_id?: string; order_hour?: string; source?: string;
  created_at: string; paid_at?: string | null;
  client_modified?: boolean;
}

interface Props {
  fecha: string;
  tickets: Ticket[];
  orders: Order[];
  search: string;
  diaCerrado: boolean;
  onOpenTicket: (ticketId: string) => void;
  onCreateFromTicket: (ticket: Ticket) => void;
}

const COL_COLORS: Record<string, string> = {
  nuevo: '#94A3B8', preparando: '#F59E0B', listo: '#3B82F6',
  camino: '#8B5CF6', entregado: '#0D9488', cerrado: '#1A7A4A',
};

const COL_BG: Record<string, string> = {
  nuevo: '#F8FAFC', preparando: '#FFFBEB', listo: '#EFF6FF',
  camino: '#F5F3FF', entregado: '#F0FDFA', cerrado: '#DCFCE7',
};


function minsSinceDate(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

// Red-zone timer — exactly two scenarios, nothing else:
// - No order yet → minutes since the ticket's first message.
// - An order exists but isn't closed (paid + cerrado) yet → minutes since the earliest
//   still-open order was created.
// A ticket whose orders are all paid+cerrado is never urgent, no matter how long ago
// that was or whether the customer wrote again after — that's not what this alerts on.
function ticketElapsedMins(ticket: Ticket, ticketOrders: Order[]): number {
  if (ticketOrders.length === 0) {
    // Since the FIRST message, not the last — otherwise the client sending another
    // message while still unattended keeps resetting the clock instead of the wait
    // actually getting more urgent the longer it drags on.
    return minsSinceDate(ticket.created_at);
  }

  const activeOrders = ticketOrders.filter(o => !(o.paid && o.status === 'cerrado'));
  if (activeOrders.length === 0) return 0;
  const firstActiveMs = activeOrders.reduce(
    (min, o) => Math.min(min, new Date(o.created_at).getTime()),
    Infinity,
  );
  return Math.floor((Date.now() - firstActiveMs) / 60000);
}

function isOrderUrg(order: Order): boolean {
  if (order.paid || order.status === 'cerrado') return false;
  return minsSinceDate(order.created_at) > 20;
}

function isTicketUrg(ticket: Ticket, ticketOrders: Order[]): boolean {
  return ticketElapsedMins(ticket, ticketOrders) > 20;
}

export default function Swimlane({ fecha, tickets, orders, search, diaCerrado, onOpenTicket, onCreateFromTicket }: Props) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cobroDirectId, setCobroDirectId] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [collapsedTickets, setCollapsedTickets] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);
  const moveOrder = useMoveOrder();
  const drag = useRef<{ orderId: string; ticketId: string | null } | null>(null);
  // Red-zone only means something for what's happening right now — looking at a past
  // day shouldn't paint everything on it as urgent forever.
  const isToday = fecha === todayStr();

  function toggleExpand(orderId: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  }

  function toggleCollapseTicket(ticketId: string) {
    setCollapsedTickets((prev) => {
      const next = new Set(prev);
      next.has(ticketId) ? next.delete(ticketId) : next.add(ticketId);
      return next;
    });
  }

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const filteredTickets = tickets.filter((t) =>
    !search || t.customer_name.toLowerCase().includes(search.toLowerCase()) || t.phone.includes(search)
  );

  const filteredOrders = orders.filter((o) =>
    o.status !== 'papelera' &&
    (!search ||
      o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      o.num.includes(search) ||
      o.address?.toLowerCase().includes(search.toLowerCase()))
  );

  function moveNext(order: Order) {
    if (diaCerrado) return;
    const idx = STATUS_ORDER.indexOf(order.status);
    if (idx < 0 || idx >= STATUS_ORDER.length - 1) return; // already 'cerrado'
    const nextStatus = STATUS_ORDER[idx + 1];
    if (nextStatus === 'cerrado') {
      // 'cerrado' isn't a plain status move — the backend only allows reaching it
      // through the guarded /cobro flow (amount received + password). Same path the
      // drag-and-drop-onto-"cerrado" column already uses below.
      const total = order.items.reduce((s, i) => s + Number(i.price), 0);
      if (total <= 0) {
        toast('No es posible cerrar el pedido porque no tiene un total calculado', true);
        return;
      }
      setCobroDirectId(order.id);
      return;
    }
    moveOrder.mutate({ id: order.id, status: nextStatus }, {
      onError: (e: any) => toast(e.message, true),
    });
  }

  function movePrev(order: Order) {
    if (diaCerrado) return;
    const idx = STATUS_ORDER.indexOf(order.status);
    if (idx <= 0) return;
    moveOrder.mutate({ id: order.id, status: STATUS_ORDER[idx - 1] }, {
      onError: (e: any) => toast(e.message, true),
    });
  }

  function handleDragStart(e: React.DragEvent, order: Order, ticketId: string | null) {
    drag.current = { orderId: order.id, ticketId };
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(e: React.DragEvent, targetStatus: string, targetTicketId: string | null) {
    e.preventDefault();
    if (!drag.current) return;
    if (diaCerrado) { toast('Día cerrado — vista de solo lectura', true); drag.current = null; return; }
    if (drag.current.ticketId !== targetTicketId) {
      toast('Solo puedes mover el pedido dentro de la fila de este cliente', true);
      drag.current = null;
      return;
    }
    const order = orders.find((o) => o.id === drag.current!.orderId);
    if (!order || order.status === targetStatus) { drag.current = null; return; }
    if (order.locked) { toast('Pedido bloqueado', true); drag.current = null; return; }
    if (targetStatus === 'cerrado') {
      const total = order.items.reduce((s, i) => s + Number(i.price), 0);
      if (total <= 0) {
        toast('No es posible cerrar el pedido porque no tiene un total calculado', true);
        drag.current = null;
        return;
      }
      setCobroDirectId(drag.current.orderId);
      drag.current = null;
      return;
    }
    moveOrder.mutate({ id: order.id, status: targetStatus }, {
      onError: (e: any) => toast(e.message, true),
    });
    drag.current = null;
  }

  const ordersByStatus = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = filteredOrders.filter((o) => o.status === s);
    return acc;
  }, {} as Record<string, Order[]>);


  const urgTickets = isToday ? filteredTickets.filter((t) => {
    const tOrds = filteredOrders.filter((o) => t.orders.some((to) => to.id === o.id));
    return isTicketUrg(t, tOrds);
  }) : [];

  function renderCard(ord: Order, ticketId: string | null) {
    const showTimer = !ord.paid && ord.status !== 'cerrado';
    const mins = showTimer ? minsSinceDate(ord.created_at) : 0;
    const urg = isToday && isOrderUrg(ord);
    const warn = showTimer && mins > 15;
    const total = ord.items.reduce((sum, i) => sum + Number(i.price), 0);
    const isExpanded = expandedCards.has(ord.id);
    const visibleItems = isExpanded ? ord.items : ord.items.slice(0, 2);
    const hasMore = ord.items.length > 2;

    // Deferred badge logic
    // notes can contain MULTIPLE 'pasado_manana:SOURCE_DATE' markers, one per deferral —
    // an order left open two cierres in a row picks up a second one on top of the first
    // (see cierre.ts, notes are appended, never replaced). Matching only the FIRST marker
    // (old behavior) meant an order deferred twice showed as a normal, fully-interactive
    // card on the day it briefly sat on in between — its real fecha had already moved on
    // again, so that day no longer owned it either, but nothing here said so. Collecting
    // every marker and checking whether ANY of them names the day being viewed is what
    // actually mirrors "this order passed through here at some point".
    const deferredDates = [...((ord as any).notes?.matchAll(/pasado_manana:(\d{4}-\d{2}-\d{2})/g) ?? [])].map((m) => m[1]);
    const ordFecha: string | null = (ord as any).fecha ? new Date((ord as any).fecha).toISOString().split('T')[0] : null;
    // Ghost: viewing a day it was deferred AWAY FROM — this board no longer owns it (it
    // lives on ordFecha now), show as a dimmed, non-interactive trace.
    const isGhost = deferredDates.includes(fecha);
    // Arrived: viewing the day it's actually on now (its real, current fecha) — fully
    // active/interactive, just flagged with a badge noting it came from a deferral.
    const isDeferred = deferredDates.length > 0 && ordFecha !== null && ordFecha === fecha;
    // Once cierre ran for this day, the whole board becomes a read-only snapshot —
    // every card on it freezes (not just the specific order that got deferred away),
    // so a "dejar_activo" order left open at close time doesn't stay silently
    // draggable/editable forever on a day that's supposed to be closed history.
    const frozen = diaCerrado || isGhost;

    return (
      <div
        className="dc-card"
        style={{
          position: 'relative',
          borderLeftColor: COL_COLORS[ord.status],
          cursor: (ord.locked || frozen) ? 'default' : 'grab',
          opacity: frozen ? 0.72 : 1,
          ...(urg ? { background: '#FFF5F5', borderColor: '#FECACA' } : {}),
        }}
        draggable={!ord.locked && !frozen}
        onDragStart={(e) => !frozen && handleDragStart(e, ord, ticketId)}
        onClick={() => setDetailId(ord.id)}
      >
        {ord.client_modified && (
          <div title="El cliente modificó este pedido — sin revisar"
            style={{
              position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: '50%',
              background: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 4px rgba(0,0,0,.25)', zIndex: 1,
            }}>
            <Bell size={11} color="#fff" fill="#fff" />
          </div>
        )}
        {(isGhost || isDeferred) && (
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--az)', background: 'var(--azc)', padding: '2px 7px', borderRadius: 20, marginBottom: 5, display: 'inline-block' }}>
            Pospuesto
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
          <div className="dc-num">#{ord.num}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {ord.status === 'nuevo' && mins > 0 && (
              <div style={{
                fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 20,
                background: urg ? '#FEE2E2' : warn ? '#FEF3C7' : 'var(--gm)',
                color: urg ? '#DC2626' : warn ? '#D97706' : 'var(--gt)',
                animation: urg ? 'pulse 1.5s infinite' : undefined,
              }}>
                {mins}min
              </div>
            )}
            {ord.source === 'form' ? (
              <div style={{ fontSize: 10, fontWeight: 800, color: '#7C3AED', background: '#EDE9FE', padding: '2px 6px', borderRadius: 20 }}>
                Formulario
              </div>
            ) : (
              <div style={{ fontSize: 10, fontWeight: 800, color: '#0369A1', background: '#E0F2FE', padding: '2px 6px', borderRadius: 20 }}>
                Encargado
              </div>
            )}
            {ord.paid && (
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--v)', background: 'var(--vc)', padding: '2px 6px', borderRadius: 20 }}>
                Pagado
              </div>
            )}
          </div>
        </div>
        <div className="dc-prod">
          {visibleItems.map((i) => `${i.product_name ?? ''} ${i.quantity_label ?? ''}`.trim()).join(', ')}
          {hasMore && (
            <span
              onClick={(e) => { e.stopPropagation(); toggleExpand(ord.id); }}
              style={{ color: 'var(--v)', fontWeight: 700, cursor: 'pointer', marginLeft: 4, fontSize: 11 }}
            >
              {isExpanded
                ? <><ChevronUp size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> menos</>
                : ` +${ord.items.length - 2} más`}
            </span>
          )}
        </div>
        <div className="dc-tot">{fmtCOP(total)}</div>
        <div className="dc-nav">
          <button className="dc-btn" title="Retroceder"
            disabled={ord.locked || frozen || STATUS_ORDER.indexOf(ord.status) === 0}
            onClick={(e) => { e.stopPropagation(); movePrev(ord); }}>
            <ChevronLeft size={14} />
          </button>
          <button className="dc-det-btn" onClick={(e) => { e.stopPropagation(); setDetailId(ord.id); }}>
            <Eye size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />Ver
          </button>
          <button className="dc-btn" title={ord.status === 'entregado' ? 'Cerrar pedido' : 'Avanzar'}
            disabled={ord.locked || frozen || ord.status === 'cerrado'}
            onClick={(e) => { e.stopPropagation(); moveNext(ord); }}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {urgTickets.length > 0 && (
        <div style={{
          background: '#FEE2E2', border: '2px solid #F87171', borderRadius: 'var(--rad)',
          padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <Siren size={18} color="#991B1B" />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#991B1B' }}>
            ZONA ROJA - {urgTickets.length} chat{urgTickets.length > 1 ? 's' : ''} sin resolver
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {urgTickets.map((t) => {
              const tNum = `T-${String(filteredTickets.indexOf(t) + 1).padStart(2, '0')}`;
              return (
                <button key={t.id} onClick={() => onOpenTicket(t.id)}
                  style={{
                    background: '#DC2626', color: '#fff', border: 'none',
                    padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', animation: 'pulse 1.5s infinite',
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                  }}>
                  <AlertTriangle size={11} />
                  {tNum}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {diaCerrado && (
        <div style={{
          background: 'var(--gm)', border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)',
          padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Lock size={16} color="var(--gt)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gt)' }}>
            Día cerrado — vista de solo lectura, nada se puede mover ni modificar.
          </span>
        </div>
      )}

      <div className="slane-wrap">
        <div className="slane">
          <div className="slane-hcell wpp-col">
            <MessageSquare size={14} strokeWidth={2.5} /> Conversaciones WPP
          </div>
          {STATUS_ORDER.map((s) => (
            <div key={s} className="slane-hcell" style={{ background: COL_BG[s] }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: COL_COLORS[s], display: 'inline-block', flexShrink: 0 }} />
              {STATUS_LABEL[s]}
              <span style={{ marginLeft: 'auto', background: 'var(--bg)', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                {ordersByStatus[s]?.length ?? 0}
              </span>
            </div>
          ))}

          {filteredTickets.map((ticket) => {
            const ticketOrders = filteredOrders.filter((o) => ticket.orders.some((to) => to.id === o.id));
            const urg = isToday && isTicketUrg(ticket, ticketOrders);
            const isCollapsed = collapsedTickets.has(ticket.id);
            const tNum = `T-${String(filteredTickets.indexOf(ticket) + 1).padStart(2, '0')}`;

            // Same ghost/arrived split as orders above, applied to the ticket itself —
            // cierre.ts sets deferred_to on the ticket but never touches its own `fecha`
            // (see schema comment on Ticket.fecha), so `fecha` is still the day it left
            // FROM and `deferred_to` is the day it landed ON. Before this, the "Pospuesto"
            // badge showed identically on both days (just `!!deferred_to`, no date check),
            // so a chat looked exactly as "live" on the day it already left as on the day
            // it arrived — the one place a viewer could actually tell the two apart was
            // its order card underneath (dimmed vs not), which made the row visually
            // contradict itself.
            const ticketFechaStr = (ticket as any).fecha ? new Date((ticket as any).fecha).toISOString().split('T')[0] : null;
            const ticketDeferredToStr = (ticket as any).deferred_to ? new Date((ticket as any).deferred_to).toISOString().split('T')[0] : null;
            const isTicketGhost = !!ticketDeferredToStr && ticketFechaStr === fecha;
            const isTicketArrived = !!ticketDeferredToStr && ticketDeferredToStr === fecha;

            if (isCollapsed) {
              return (
                <div key={ticket.id} style={{ display: 'contents' }}>
                  <div
                    className={`slane-tcell${urg ? ' urg' : ''}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 0, padding: '7px 12px', cursor: 'pointer' }}
                    onClick={() => toggleCollapseTicket(ticket.id)}
                  >
                    <ChevronDown size={14} color="var(--gt)" />
                    <span className="tk-num" style={{ marginRight: 4 }}>{tNum}</span>
                    {ticket.unread_count > 0 && <span className="inbox-unread" style={{ fontSize: 10, padding: '1px 5px' }}>{ticket.unread_count}</span>}
                    <span style={{ fontSize: 13, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.customer_name}</span>
                    <span className={`tk-badge ${ticketOrders.length > 0 ? (ticketOrders.every((o) => o.paid) ? 'done' : 'activo') : 'sin'}`}>
                      {ticketOrders.length > 0 ? `${ticketOrders.length}p` : '—'}
                    </span>
                  </div>
                  {STATUS_ORDER.map((s) => (
                    <div key={s} className="slane-scell" style={{ minHeight: 0, padding: 0, height: 36, background: COL_BG[s] }} />
                  ))}
                </div>
              );
            }

            return (
              <div key={ticket.id} style={{ display: 'contents' }}>
                <div className={`slane-tcell${urg ? ' urg' : ''}`} onClick={() => onOpenTicket(ticket.id)}
                  style={{ opacity: isTicketGhost ? 0.72 : 1 }}>
                  {ticket.unread_count > 0 && <div className="tk-new-dot">{ticket.unread_count}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span className="tk-num">{tNum}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {urg && <span className="tk-urg"><AlertTriangle size={10} />{ticketElapsedMins(ticket, ticketOrders)}min</span>}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleCollapseTicket(ticket.id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--gt)', display: 'flex', alignItems: 'center' }}
                        title="Contraer fila"
                      >
                        <ChevronUp size={14} />
                      </button>
                    </div>
                  </div>
                  {(isTicketGhost || isTicketArrived) && (
                    <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--az)', background: 'var(--azc)', padding: '2px 7px', borderRadius: 20, marginBottom: 4, display: 'inline-block' }}>
                      Pospuesto
                    </div>
                  )}
                  <div className="tk-phone">{ticket.phone}</div>
                  <div className="tk-name">{ticket.customer_name}</div>
                  <div className="tk-foot">
                    <span className="tk-time">
                      {new Date(ticket.last_message_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}
                    </span>
                    <span className={`tk-badge ${ticketOrders.length > 0 ? (ticketOrders.every((o) => o.paid) ? 'done' : 'activo') : 'sin'}`}>
                      {ticketOrders.length > 0 ? `${ticketOrders.length} pedido${ticketOrders.length > 1 ? 's' : ''}` : 'Sin pedido'}
                    </span>
                  </div>
                  <button className="tk-ver-btn" style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                    onClick={(e) => { e.stopPropagation(); onOpenTicket(ticket.id); }}>
                    Ver conversación <ChevronRight size={12} strokeWidth={2.5} />
                  </button>
                  {!diaCerrado && !isTicketGhost && (
                    <button className="tk-crear-btn"
                      onClick={(e) => { e.stopPropagation(); onCreateFromTicket(ticket); }}>
                      <Plus size={11} strokeWidth={3} /> Crear pedido de despacho
                    </button>
                  )}
                </div>

                {STATUS_ORDER.map((s) => {
                  const ordsInStatus = ticketOrders.filter((o) => o.status === s);
                  return (
                    <div key={s} className="slane-scell"
                      style={{ background: COL_BG[s] }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDrop(e, s, ticket.id)}>
                      {ordsInStatus.map((ord) => renderCard(ord, ticket.id))}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {filteredTickets.length === 0 && (
            <div style={{ gridColumn: '1 / -1', padding: 28, textAlign: 'center', background: 'var(--b)', color: 'var(--gt)', fontSize: 14 }}>
              Sin tickets
            </div>
          )}

        </div>
      </div>

      {detailId && <DetallePedidoModal orderId={detailId} onClose={() => setDetailId(null)} />}
      {cobroDirectId && <DetallePedidoModal orderId={cobroDirectId} onClose={() => setCobroDirectId(null)} openCobro />}
    </>
  );
}
