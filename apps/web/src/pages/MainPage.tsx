import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { useOrders } from '../hooks/useOrders';
import { useDashboard } from '../hooks/useDashboard';
import { api } from '../lib/api';
import { todayStr, fmtCOP } from '../lib/format';
import { getSocket, disconnectSocket } from '../lib/socket';
import { useQueryClient } from '@tanstack/react-query';
import Swimlane from '../components/orders/Swimlane';
import NuevoPedidoModal from '../components/modals/NuevoPedidoModal';
import TicketModal from '../components/modals/TicketModal';
import Toast from '../components/ui/Toast';

export default function MainPage() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();

  const [fecha, setFecha] = useState(todayStr());
  const [tab, setTab] = useState<'swimlane' | 'resumen'>('swimlane');
  const [search, setSearch] = useState('');
  const [showNuevo, setShowNuevo] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);

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

    socket.on('order:created', () => qc.invalidateQueries({ queryKey: ['orders', fecha] }));
    socket.on('order:updated', () => qc.invalidateQueries({ queryKey: ['orders', fecha] }));
    socket.on('order:moved', () => qc.invalidateQueries({ queryKey: ['orders', fecha] }));
    socket.on('order:paid', () => qc.invalidateQueries({ queryKey: ['orders', fecha] }));
    socket.on('ticket:message', () => qc.invalidateQueries({ queryKey: ['tickets', fecha] }));

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

  const totalPedidos = orders.length;
  const pendientes = orders.filter((o: any) => !['cerrado', 'papelera'].includes(o.status)).length;

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
            📋 Tickets & Pedidos
          </button>
          {isAdmin && (
            <button className={`tab${tab === 'resumen' ? ' on' : ''}`} onClick={() => setTab('resumen')}>
              📊 Resumen del día
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
                <div className="sbx" style={{ minWidth: 170 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input type="text" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <button className="bnew" onClick={() => setShowNuevo(true)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Nuevo pedido
                </button>
              </div>
            </div>

            <Swimlane
              tickets={tickets}
              orders={orders}
              search={search}
              onOpenTicket={(id) => setTicketId(id)}
            />
          </>
        )}

        {tab === 'resumen' && isAdmin && dashboard && (
          <>
            <div className="khead">
              <div>
                <div className="ktit">Resumen del día</div>
                <div className="kmeta">Totales en tiempo real</div>
              </div>
            </div>
            <div className="agrid">
              <div className="acard"><div className="ai">📋</div><div className="av">{dashboard.totales?.total ?? 0}</div><div className="al2">Pedidos totales</div></div>
              <div className="acard v"><div className="ai">✅</div><div className="av">{dashboard.totales?.entregados ?? 0}</div><div className="al2">Entregados</div></div>
              <div className="acard r"><div className="ai">⏳</div><div className="av">{dashboard.totales?.pendientes ?? 0}</div><div className="al2">Pendientes</div></div>
              <div className="acard az"><div className="ai">🛵</div><div className="av">{dashboard.totales?.domActivos ?? 0}</div><div className="al2">Domicilios activos</div></div>
            </div>
            <div className="drow">
              <div className="dcard2 v"><div className="dico v">💵</div><div><div className="dlbl">Recaudado efectivo</div><div className="dval">{fmtCOP(dashboard.recaudado?.efectivo ?? 0)}</div></div></div>
              <div className="dcard2 az"><div className="dico az">📲</div><div><div className="dlbl">Recaudado transferencia</div><div className="dval">{fmtCOP(dashboard.recaudado?.transferencia ?? 0)}</div></div></div>
              <div className="dcard2 tot"><div className="dico n">💰</div><div><div className="dlbl">Total recaudado</div><div className="dval">{fmtCOP(dashboard.recaudado?.total ?? 0)}</div></div></div>
            </div>
          </>
        )}
      </div>

      {showNuevo && <NuevoPedidoModal fecha={fecha} onClose={() => setShowNuevo(false)} />}
      {ticketId && <TicketModal ticketId={ticketId} onClose={() => setTicketId(null)} />}
      <Toast />
    </div>
  );
}
