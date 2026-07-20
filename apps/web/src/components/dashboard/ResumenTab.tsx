import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Package, PackageCheck, Clock, Banknote, ArrowLeftRight, Wallet,
  FileText, Trash2, History, ChevronDown, ChevronRight, Lock, Download, Ban,
  MessageSquare, MessageCircleWarning, MessageCircleCheck,
} from 'lucide-react';
import { STATUS_LABEL, fmtCOP, PAYMENT_LABEL, todayStr } from '../../lib/format';
import { downloadCierreCSV } from '../../lib/csv';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { ConfirmModal } from '../ui/ConfirmModal';
import HistoryTable from '../ui/HistoryTable';
import DatePickerES from '../ui/DatePickerES';

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  nuevo: { bg: '#F8FAFC', fg: '#94A3B8' },
  preparando: { bg: '#FFFBEB', fg: '#D97706' },
  listo: { bg: '#EFF6FF', fg: '#2563EB' },
  camino: { bg: '#F5F3FF', fg: '#7C3AED' },
  entregado: { bg: '#E8F5EE', fg: '#1A7A4A' },
  cerrado: { bg: '#E8F5EE', fg: '#0F4F30' },
  papelera: { bg: '#FDEDEC', fg: '#C0392B' },
};

interface Props {
  fecha: string;
  setFecha: (d: string) => void;
  dashboard: any;
  papeleraOrders: any[];
  history: any[];
  orders: any[];
  onCierreCaja: () => void;
  onOpenOrder: (orderId: string) => void;
}

export default function ResumenTab({ fecha, setFecha, dashboard, papeleraOrders, history, onCierreCaja, onOpenOrder }: Props) {
  const [resumenTab, setResumenTab] = useState<'activos' | 'papelera' | 'cambios'>('activos');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showBlockAllConfirm, setShowBlockAllConfirm] = useState(false);

  // Emergency kill switch - e.g. the store closes early one day and every form link
  // sent out today needs to die right now, not just the one someone remembers to
  // individually revoke. A fresh link sent afterward works normally again.
  const blockAllLinksMut = useMutation({
    mutationFn: () => api.post('/inbox/form-links/block-all', {}),
    onSuccess: () => toast('Todos los links de formulario activos fueron bloqueados'),
    onError: (e: any) => toast(e.message ?? 'No se pudo bloquear los links', true),
  });

  function toggleOrder(id: string) {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // Build per-order history map from the global history list
  const histByOrder = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const h of (history ?? [])) {
      const orderId = h.order_id ?? h.orderId;
      if (!orderId) continue;
      if (!map[orderId]) map[orderId] = [];
      map[orderId].push(h);
    }
    return map;
  }, [history]);

  const STATUS_SORT: Record<string, number> = {
    nuevo: 0, preparando: 1, listo: 2, camino: 3, entregado: 4, cerrado: 5,
  };

  const filteredOrders: any[] = useMemo(
    () => [...(dashboard?.orders ?? [])].sort((a, b) =>
      (STATUS_SORT[a.status] ?? 99) - (STATUS_SORT[b.status] ?? 99)
    ),
    [dashboard?.orders]
  );

  // Group orders by ticket_id (same chat) or customer_name fallback
  const orderGroups = useMemo(() => {
    const groups: { key: string; label: string; orders: any[] }[] = [];
    const seen = new Map<string, any[]>();
    for (const o of filteredOrders) {
      const key = o.ticket_id ?? `name:${o.customer_name}`;
      if (!seen.has(key)) { seen.set(key, []); }
      seen.get(key)!.push(o);
    }
    for (const [key, orders] of seen.entries()) {
      const label = orders[0].customer_name;
      groups.push({ key, label, orders });
    }
    return groups;
  }, [filteredOrders]);

  return (
    <>
      <div className="khead">
        <div>
          <div className="ktit">Informe del día</div>
          <div className="kmeta">Tiempo real - actualización automática</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <DatePickerES value={fecha} onChange={setFecha} />
          {dashboard?.cierre?.cerrado ? (
            <>
              <button disabled title={dashboard.cierre.closedByName ? `Cerrada por ${dashboard.cierre.closedByName}` : ''}
                style={{ background: 'var(--bg)', color: 'var(--gt)', border: '1px solid var(--brd)', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                <Lock size={15} /> Caja ya cerrada
              </button>
              {/* Re-downloadable any time after the close, not just in the one live
                  session that ran it - decisions come from the persisted DailyClose
                  row (GET /dashboard), same report either way. */}
              <button
                onClick={() => downloadCierreCSV(fecha, dashboard.orders ?? [], dashboard.cierre.decisions ?? {})}
                style={{ background: 'var(--vd)', color: '#fff', border: 'none', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                <Download size={15} /> Descargar CSV
              </button>
            </>
          ) : fecha !== todayStr() ? (
            // Cierre only ever applies to the live, current day (see cierre.ts's
            // NOT_TODAY check) - a past day with pending orders is done, not
            // reconcilable anymore, and a future day has nothing to close yet.
            <button disabled title="Solo se puede cerrar la caja del día actual"
              style={{ background: 'var(--bg)', color: 'var(--gt)', border: '1px solid var(--brd)', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
              <Lock size={15} /> Cerrar caja
            </button>
          ) : (
            <button onClick={onCierreCaja}
              style={{ background: 'var(--vd)', color: '#fff', border: 'none', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
              <Lock size={15} /> Cerrar caja
            </button>
          )}
          <button
            onClick={() => setShowBlockAllConfirm(true)}
            disabled={blockAllLinksMut.isPending}
            title="Bloquea todos los links de formulario activos ahora mismo, sin importar la hora"
            style={{ background: 'var(--rc)', color: 'var(--r)', border: '1px solid var(--r)', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
            <Ban size={15} /> Bloquear todos los links
          </button>
        </div>
      </div>

      {showBlockAllConfirm && (
        <ConfirmModal
          message="Vas a bloquear TODOS los links de formulario activos ahora mismo, para todos los chats. Ningún cliente podrá crear ni editar pedidos por el link hasta que le envíes uno nuevo. ¿Deseas continuar?"
          confirmLabel="Bloquear todos"
          danger
          onConfirm={() => { blockAllLinksMut.mutate(); setShowBlockAllConfirm(false); }}
          onCancel={() => setShowBlockAllConfirm(false)}
        />
      )}

      {dashboard && (
        <>
          <div className="arow">
            {/* Chat stats */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                Chats de WhatsApp
              </div>
              <div className="agrid">
                <div className="acard">
                  <div className="ai"><MessageSquare size={26} color="var(--gt)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.chats?.total ?? 0}</div>
                  <div className="al2">Chats totales</div>
                </div>
                <div className="acard r">
                  <div className="ai"><MessageCircleWarning size={26} color="var(--r)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.chats?.activos ?? 0}</div>
                  <div className="al2">Chat con pedido activo</div>
                </div>
                <div className="acard v">
                  <div className="ai"><MessageCircleCheck size={26} color="var(--v)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.chats?.completos ?? 0}</div>
                  <div className="al2">Chat con pedidos completados</div>
                </div>
              </div>
            </div>

            {/* Order stats */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                Pedidos
              </div>
              <div className="agrid">
                <div className="acard">
                  <div className="ai"><Package size={26} color="var(--gt)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.totales?.total ?? 0}</div>
                  <div className="al2">Pedidos totales</div>
                </div>
                <div className="acard r">
                  <div className="ai"><Clock size={26} color="var(--r)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.totales?.pendientes ?? 0}</div>
                  <div className="al2">Pendientes</div>
                </div>
                <div className="acard v">
                  <div className="ai"><PackageCheck size={26} color="var(--v)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.totales?.entregados ?? 0}</div>
                  <div className="al2">Cerrados/Cobrados</div>
                </div>
              </div>
            </div>
          </div>

          <div className="drow">
            <div className="dcard2 v">
              <div className="dico v"><Banknote size={22} color="var(--v)" strokeWidth={1.5} /></div>
              <div><div className="dlbl">Recaudado efectivo</div><div className="dval">{fmtCOP(dashboard.recaudado?.efectivo ?? 0)}</div></div>
            </div>
            <div className="dcard2 az">
              <div className="dico az"><ArrowLeftRight size={22} color="var(--az)" strokeWidth={1.5} /></div>
              <div><div className="dlbl">Recaudado transferencia</div><div className="dval">{fmtCOP(dashboard.recaudado?.transferencia ?? 0)}</div></div>
            </div>
            <div className="dcard2 tot">
              <div className="dico n"><Wallet size={22} color="var(--n)" strokeWidth={1.5} /></div>
              <div><div className="dlbl">Total recaudado</div><div className="dval">{fmtCOP(dashboard.recaudado?.total ?? 0)}</div></div>
            </div>
          </div>

        </>
      )}

      <div className="atabs">
        <button className={`atab${resumenTab === 'activos' ? ' on' : ''}`} onClick={() => setResumenTab('activos')}>
          <FileText size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          Pedidos ({dashboard?.orders?.length ?? 0})
        </button>
        <button className={`atab${resumenTab === 'papelera' ? ' on' : ''}`} onClick={() => setResumenTab('papelera')}>
          <Trash2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          Papelera ({papeleraOrders.length})
        </button>
        <button className={`atab${resumenTab === 'cambios' ? ' on' : ''}`} onClick={() => setResumenTab('cambios')}>
          <History size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          Cambios ({history.length})
        </button>
      </div>

      {resumenTab === 'activos' && (
        <div className="htab">
          <div className="hth">
            <span>{filteredOrders.length} pedido{filteredOrders.length !== 1 ? 's' : ''} · {orderGroups.length} cliente{orderGroups.length !== 1 ? 's' : ''}</span>
          </div>
          {filteredOrders.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              Sin pedidos en este estado
            </div>
          )}
          {orderGroups.map(({ key, label, orders: groupOrders }) => {
            const isGroupCollapsed = collapsedGroups.has(key);
            const groupTotal = groupOrders.reduce((s: number, o: any) =>
              s + (o.items?.reduce((ss: number, i: any) => ss + Number(i.price), 0) ?? 0), 0);

            return (
              <div key={key} style={{ borderBottom: '2px solid var(--brd)' }}>
                {/* Group header - always shown */}
                <div
                  onClick={() => toggleGroup(key)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 18px', background: 'var(--vc)', cursor: 'pointer',
                    borderBottom: isGroupCollapsed ? 'none' : '1px solid var(--brd)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isGroupCollapsed ? <ChevronRight size={15} color="var(--v)" /> : <ChevronDown size={15} color="var(--v)" />}
                    <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--vd)' }}>{label}</span>
                    <span style={{ fontSize: 12, background: 'var(--vm)', color: 'var(--vd)', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>
                      {groupOrders.length} {groupOrders.length === 1 ? 'pedido' : 'pedidos'}
                    </span>
                  </div>
                  <span style={{ fontWeight: 800, color: 'var(--v)', fontSize: 14 }}>{fmtCOP(groupTotal)}</span>
                </div>

                {/* Orders within group */}
                {!isGroupCollapsed && groupOrders.map((o: any) => {
                  const total = o.items?.reduce((s: number, i: any) => s + Number(i.price), 0) ?? 0;
                  const orderHist = histByOrder[o.id] ?? [];
                  const isExp = expandedOrders.has(o.id);
                  const col = STATUS_COLORS[o.status] ?? { bg: 'var(--bg)', fg: 'var(--gt)' };

                  return (
                    <div key={o.id} style={{ borderBottom: '1px solid var(--brd)' }}>
                      <div
                        className="hrow hrow-exp"
                        onClick={() => toggleOrder(o.id)}
                        style={{
                          gridTemplateColumns: '50px 1fr auto auto auto 28px',
                          paddingLeft: 32,
                        }}
                      >
                        <div className="hnum">#{o.num}</div>
                        <div>
                          <div className="hdir">{o.address}</div>
                        </div>
                        <div>
                          <span className="ebadge" style={{ background: col.bg, color: col.fg }}>
                            {STATUS_LABEL[o.status] ?? o.status}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {orderHist.length > 0 && (
                            <span className="chg-cnt">{orderHist.length} cambio{orderHist.length !== 1 ? 's' : ''}</span>
                          )}
                          <span style={{ fontWeight: 800, color: 'var(--v)', fontSize: 14 }}>{fmtCOP(total)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--gt)' }}>
                          {isExp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>
                      </div>

                      {isExp && (
                        <div className="ord-hist-sub" style={{ paddingLeft: 32 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 12px', fontSize: 13, marginBottom: orderHist.length > 0 ? 10 : 0 }}>
                            <div><span style={{ color: 'var(--gt)' }}>Teléfono: </span>{o.customer_phone ?? '-'}</div>
                            <div><span style={{ color: 'var(--gt)' }}>Pago: </span>{PAYMENT_LABEL[o.payment_method] ?? o.payment_method ?? '-'}</div>
                            <div><span style={{ color: 'var(--gt)' }}>Dom: </span>{o.employee?.name ?? 'Sin asignar'}</div>
                          </div>
                          {o.items && o.items.length > 0 && (
                            <div style={{ fontSize: 13, marginBottom: orderHist.length > 0 ? 10 : 0 }}>
                              <strong>Productos: </strong>
                              {o.items.map((i: any) => `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`).join(' · ')}
                            </div>
                          )}
                          {orderHist.length > 0 && (
                            <>
                              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
                                Historial de cambios
                              </div>
                              <HistoryTable history={orderHist} />
                            </>
                          )}
                          {orderHist.length === 0 && (
                            <div style={{ fontSize: 13, color: 'var(--gt)' }}>Sin cambios registrados</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {resumenTab === 'papelera' && (
        <div style={{ padding: '4px 0' }}>
          {papeleraOrders.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              No hay pedidos en papelera hoy
            </div>
          )}
          {papeleraOrders.map((o: any) => {
            const total = o.items?.reduce((s: number, i: any) => s + Number(i.price), 0) ?? 0;
            return (
              <div key={o.id} className="papcard" onClick={() => onOpenOrder(o.id)}
                title="Ver detalle - quién lo envió a la papelera y cuándo"
                style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>#{o.num} - {o.customer_name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Trash2 size={11} /> {new Date(o.updated_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--gt)', marginBottom: 3 }}>{o.address}</div>
                <div style={{ fontSize: 13, color: 'var(--gt)' }}>
                  {o.items?.map((i: any) => `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`).join(' · ')}
                </div>
                <div style={{ fontSize: 13, marginTop: 4, fontWeight: 700 }}>
                  {fmtCOP(total)} · {PAYMENT_LABEL[o.payment_method] ?? o.payment_method}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {resumenTab === 'cambios' && (
        <div style={{ padding: '4px 0' }}>
          {history.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              No hay cambios registrados
            </div>
          ) : (
            <HistoryTable history={history} showOrder />
          )}
        </div>
      )}
    </>
  );
}
