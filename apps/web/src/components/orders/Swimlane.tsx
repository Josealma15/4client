import { useState } from 'react';
import { STATUS_LABEL, STATUS_ORDER, fmtCOP } from '../../lib/format';
import { useMoveOrder } from '../../hooks/useOrders';
import { toast } from '../ui/Toast';
import DetallePedidoModal from '../modals/DetallePedidoModal';

interface Ticket {
  id: string; phone: string; customer_name: string;
  unread_count: number; last_message_at: string;
  messages: { text: string; direction: string }[];
  orders: { id: string; num: string; status: string; paid: boolean }[];
}

interface Order {
  id: string; num: string; customer_name: string; status: string;
  paid: boolean; locked: boolean; payment_method: string;
  address: string; employee?: { name: string };
  items: { name?: string; quantity_label?: string; price: number }[];
  ticket_id?: string;
}

interface Props {
  tickets: Ticket[];
  orders: Order[];
  search: string;
  onOpenTicket: (ticketId: string) => void;
}

const COL_COLORS: Record<string, string> = {
  nuevo: '#94A3B8', preparando: '#F59E0B', listo: '#3B82F6',
  camino: '#8B5CF6', entregado: '#1A7A4A', cerrado: '#0F4F30',
};

const COL_BG: Record<string, string> = {
  nuevo: '#F8FAFC', preparando: '#FFFBEB', listo: '#EFF6FF',
  camino: '#F5F3FF', entregado: 'var(--vc)', cerrado: '#E8F5EE',
};

export default function Swimlane({ tickets, orders, search, onOpenTicket }: Props) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const moveOrder = useMoveOrder();

  const filteredTickets = tickets.filter((t) =>
    !search || t.customer_name.toLowerCase().includes(search.toLowerCase()) || t.phone.includes(search)
  );

  const filteredOrders = orders.filter((o) =>
    !search || o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
    o.num.includes(search) || o.address?.toLowerCase().includes(search.toLowerCase())
  );

  function moveNext(order: Order) {
    const idx = STATUS_ORDER.indexOf(order.status);
    if (idx < 0 || idx >= STATUS_ORDER.length - 2) return;
    const next = STATUS_ORDER[idx + 1];
    moveOrder.mutate({ id: order.id, status: next }, {
      onError: (e: any) => toast(e.message, true),
    });
  }

  function movePrev(order: Order) {
    const idx = STATUS_ORDER.indexOf(order.status);
    if (idx <= 0) return;
    const prev = STATUS_ORDER[idx - 1];
    moveOrder.mutate({ id: order.id, status: prev }, {
      onError: (e: any) => toast(e.message, true),
    });
  }

  const ordersByStatus = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = filteredOrders.filter((o) => o.status === s);
    return acc;
  }, {} as Record<string, Order[]>);

  const ticketHasOrder = new Set(tickets.flatMap((t) => t.orders.map((o) => o.id)));

  return (
    <>
      <div className="slane-wrap">
        <div className="slane">
          {/* Header row */}
          <div className="slane-hcell wpp-col">💬 Conversaciones WPP</div>
          {STATUS_ORDER.map((s) => (
            <div key={s} className="slane-hcell" style={{ background: COL_BG[s] }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: COL_COLORS[s], display: 'inline-block', flexShrink: 0 }} />
              {STATUS_LABEL[s]}
              <span style={{ marginLeft: 'auto', background: 'var(--bg)', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                {ordersByStatus[s]?.length ?? 0}
              </span>
            </div>
          ))}

          {/* Rows: one per ticket */}
          {filteredTickets.map((ticket) => {
            const lastMsg = ticket.messages[0];
            const ticketOrders = filteredOrders.filter((o) => ticket.orders.some((to) => to.id === o.id));

            return (
              <div key={ticket.id} style={{ display: 'contents' }}>
                {/* Ticket cell */}
                <div className={`slane-tcell${ticket.unread_count > 0 ? ' urg' : ''}`}
                  onClick={() => onOpenTicket(ticket.id)}>
                  {ticket.unread_count > 0 && (
                    <div className="tk-new-dot">{ticket.unread_count}</div>
                  )}
                  <div className="tk-phone">{ticket.phone}</div>
                  <div className="tk-name">{ticket.customer_name}</div>
                  {lastMsg && <div className="tk-preview">{lastMsg.direction === 'out' ? '✓ ' : ''}{lastMsg.text}</div>}
                  <div className="tk-foot">
                    <span className="tk-time">
                      {new Date(ticket.last_message_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`tk-badge ${ticketOrders.length > 0 ? 'activo' : 'sin'}`}>
                      {ticketOrders.length > 0 ? `${ticketOrders.length} pedido${ticketOrders.length > 1 ? 's' : ''}` : 'Sin pedido'}
                    </span>
                  </div>
                  <button className="tk-ver-btn" onClick={(e) => { e.stopPropagation(); onOpenTicket(ticket.id); }}>
                    Ver chat
                  </button>
                </div>

                {/* Order cells for each status column */}
                {STATUS_ORDER.map((s) => {
                  const ord = ticketOrders.find((o) => o.status === s);
                  return (
                    <div key={s} className="slane-scell">
                      {ord ? (
                        <div className="dc-card" style={{ borderLeftColor: COL_COLORS[s] }}>
                          <div className="dc-num">#{ord.num}</div>
                          <div className="dc-prod">
                            {ord.items.slice(0, 2).map((i) => `${i.name ?? ''} ${i.quantity_label ?? ''}`.trim()).join(', ')}
                            {ord.items.length > 2 && ` +${ord.items.length - 2} más`}
                          </div>
                          <div className="dc-tot">
                            {fmtCOP(ord.items.reduce((sum, i) => sum + Number(i.price), 0))}
                          </div>
                          <div className="dc-nav">
                            <button className="dc-btn" title="Retroceder"
                              disabled={ord.locked || STATUS_ORDER.indexOf(s) === 0}
                              onClick={() => movePrev(ord)}>‹</button>
                            <button className="dc-det-btn" onClick={() => setDetailId(ord.id)}>Ver</button>
                            <button className="dc-btn" title="Avanzar"
                              disabled={ord.locked || s === 'cerrado' || s === 'entregado'}
                              onClick={() => moveNext(ord)}>›</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Orphan orders (no ticket) */}
          {filteredOrders.filter((o) => !ticketHasOrder.has(o.id)).map((ord) => (
            <div key={ord.id} style={{ display: 'contents' }}>
              <div className="slane-tcell" style={{ cursor: 'default', opacity: 0.6 }}>
                <div className="tk-phone">Sin WPP</div>
                <div className="tk-name">{ord.customer_name}</div>
                <div className="tk-foot">
                  <span className="tk-badge sin">Manual</span>
                </div>
              </div>
              {STATUS_ORDER.map((s) => {
                const isThis = ord.status === s;
                return (
                  <div key={s} className="slane-scell">
                    {isThis ? (
                      <div className="dc-card" style={{ borderLeftColor: COL_COLORS[s] }}>
                        <div className="dc-num">#{ord.num}</div>
                        <div className="dc-prod">
                          {ord.items.slice(0, 2).map((i) => `${i.name ?? ''} ${i.quantity_label ?? ''}`.trim()).join(', ')}
                        </div>
                        <div className="dc-tot">
                          {fmtCOP(ord.items.reduce((sum, i) => sum + Number(i.price), 0))}
                        </div>
                        <div className="dc-nav">
                          <button className="dc-btn" disabled={ord.locked || STATUS_ORDER.indexOf(s) === 0} onClick={() => movePrev(ord)}>‹</button>
                          <button className="dc-det-btn" onClick={() => setDetailId(ord.id)}>Ver</button>
                          <button className="dc-btn" disabled={ord.locked || s === 'cerrado' || s === 'entregado'} onClick={() => moveNext(ord)}>›</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {detailId && <DetallePedidoModal orderId={detailId} onClose={() => setDetailId(null)} />}
    </>
  );
}
