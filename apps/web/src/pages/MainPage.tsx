import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList, BarChart2, MessageSquare,
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { useOrders } from '../hooks/useOrders';
import { useDashboard } from '../hooks/useDashboard';
import { api } from '../lib/api';
import { todayStr } from '../lib/format';
import { getSocket, disconnectSocket } from '../lib/socket';
import { useQueryClient } from '@tanstack/react-query';
import Swimlane from '../components/orders/Swimlane';
import NuevoPedidoModal from '../components/modals/NuevoPedidoModal';
import TicketModal from '../components/modals/TicketModal';
import CierreCajaModal from '../components/modals/CierreCajaModal';
import DetallePedidoModal from '../components/modals/DetallePedidoModal';
import InboxPanel from '../components/inbox/InboxPanel';
import ResumenTab from '../components/dashboard/ResumenTab';
import Toast from '../components/ui/Toast';

interface Ticket {
  id: string; phone: string; customer_name: string;
  unread_count: number; last_message_at: string;
  messages: { text: string; direction: string; created_at?: string }[];
  orders: { id: string; num: string; status: string; paid: boolean }[];
}

export default function MainPage() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();

  const [fecha, setFecha] = useState(todayStr());
  const [tab, setTab] = useState<'swimlane' | 'inbox' | 'resumen'>('swimlane');
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [showCierre, setShowCierre] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [fromTicket, setFromTicket] = useState<{ ticketId: string; nombre: string; phone: string; messages: any[] } | null>(null);

  const { data: orders = [], isLoading: loadingOrders } = useOrders(fecha);
  const { data: dashboard } = useDashboard(fecha);

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets', fecha],
    queryFn: () => api.get<{ data: any[] }>(`/tickets?fecha=${fecha}`).then((r) => r.data),
  });

  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);
    socket.emit('join:org', user?.orgId ?? '');
    socket.emit('join:date', fecha);

    socket.on('order:created', () => {
      qc.invalidateQueries({ queryKey: ['orders', fecha] });
      qc.invalidateQueries({ queryKey: ['tickets', fecha] }); // re-link order to ticket row
    });
    socket.on('order:updated', () => {
      qc.invalidateQueries({ queryKey: ['orders', fecha] });
      qc.invalidateQueries({ queryKey: ['tickets', fecha] });
    });
    socket.on('order:moved', () => qc.invalidateQueries({ queryKey: ['orders', fecha] }));
    socket.on('order:paid', () => qc.invalidateQueries({ queryKey: ['orders', fecha] }));
    socket.on('ticket:message', () => {
      qc.invalidateQueries({ queryKey: ['tickets', fecha] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
    });

    return () => {
      socket.off('order:created');
      socket.off('order:updated');
      socket.off('order:moved');
      socket.off('order:paid');
      socket.off('ticket:message');
    };
  }, [accessToken, fecha]);

  async function handleLogout() {
    const { refreshToken } = useAuthStore.getState();
    if (refreshToken) await api.post('/auth/logout', { refreshToken }).catch(() => {});
    disconnectSocket();
    clearAuth();
  }

  function handleCreateFromTicket(ticket: Ticket) {
    setFromTicket({
      ticketId: ticket.id,
      nombre: ticket.customer_name,
      phone: ticket.phone,
      messages: ticket.messages ?? [],
    });
  }

  const totalPedidos = orders.length;
  const pendientes = orders.filter((o: any) => !['cerrado', 'papelera'].includes(o.status)).length;
  const papeleraOrders: any[] = dashboard?.papeleraOrders ?? [];
  const history: any[] = dashboard?.history ?? [];

  return (
    <div className="al">
      <header className="ah">
        <div className="ht">
          <div className="hlogo">
            <span className="hlogo-t">4Client</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div className="huser">
              <div className={`uav${isAdmin ? ' adm' : ''}`}>{user?.name?.[0]?.toUpperCase() ?? 'U'}</div>
              <div>
                <div className="un">{user?.name}</div>
                <div className="ur2">{isAdmin ? 'Administrador' : 'Encargado'}</div>
              </div>
            </div>
            <button className="bout" onClick={handleLogout}>Salir</button>
          </div>
        </div>
        <div className="tabs">
          <button className={`tab${tab === 'swimlane' ? ' on' : ''}`} onClick={() => setTab('swimlane')}>
            <ClipboardList size={15} /> Tickets & Pedidos
          </button>
          {isAdmin && (
            <button className={`tab${tab === 'inbox' ? ' on' : ''}`} onClick={() => setTab('inbox')}>
              <MessageSquare size={15} /> Chats WPP
            </button>
          )}
          {isAdmin && (
            <button className={`tab${tab === 'resumen' ? ' on' : ''}`} onClick={() => setTab('resumen')}>
              <BarChart2 size={15} /> Informe del día
            </button>
          )}
        </div>
      </header>

      <div className="ac">
        {tab === 'swimlane' && (
          <>
            <div className="khead">
              <div>
                <div className="ktit">Tickets & Pedidos de despacho</div>
                <div className="kmeta">
                  {loadingOrders ? 'Cargando...' : `${totalPedidos} pedidos · ${pendientes} pendientes`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" className="fsel" value={fecha} style={{ cursor: 'pointer' }}
                  onChange={(e) => setFecha(e.target.value)} />
                <select className="fsel" value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
                  <option value="">Todos los pagos</option>
                  <option value="cod">Cobro en casa</option>
                  <option value="transfer">Transferencia</option>
                  <option value="cash">En tienda</option>
                </select>
                <div className="sbx" style={{ minWidth: 160 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gt)' }}>
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input type="text" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
            </div>

            <Swimlane
              tickets={tickets}
              orders={orders}
              search={search}
              paymentFilter={paymentFilter}
              onOpenTicket={(id) => setTicketId(id)}
              onCreateFromTicket={handleCreateFromTicket}
            />
          </>
        )}

        {tab === 'inbox' && isAdmin && (
          <>
            <div className="khead">
              <div>
                <div className="ktit">Chats WhatsApp</div>
                <div className="kmeta">Bandeja de entrada - todas las conversaciones</div>
              </div>
            </div>
            <InboxPanel
              onCreateFromTicket={handleCreateFromTicket}
              onOpenOrder={(orderId) => setOpenOrderId(orderId)}
            />
          </>
        )}

        {tab === 'resumen' && isAdmin && (
          <ResumenTab
            fecha={fecha}
            setFecha={setFecha}
            dashboard={dashboard}
            papeleraOrders={papeleraOrders}
            history={history}
            orders={orders}
            onCierreCaja={() => setShowCierre(true)}
          />
        )}
      </div>

      {fromTicket && (
        <NuevoPedidoModal
          fecha={fecha}
          ticketId={fromTicket.ticketId}
          preNombre={fromTicket.nombre}
          prePhone={fromTicket.phone}
          messages={fromTicket.messages}
          onClose={() => setFromTicket(null)}
        />
      )}
      {ticketId && (
        <TicketModal
          ticketId={ticketId}
          onClose={() => setTicketId(null)}
          onCreateFromTicket={handleCreateFromTicket}
          onOpenOrder={(orderId) => { setTicketId(null); setOpenOrderId(orderId); }}
        />
      )}
      {openOrderId && (
        <DetallePedidoModal orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
      )}
      {showCierre && (
        <CierreCajaModal fecha={fecha} orders={orders} onClose={() => setShowCierre(false)} />
      )}
      <Toast />
    </div>
  );
}
