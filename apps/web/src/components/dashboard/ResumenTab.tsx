import { useState, useMemo } from 'react';
import {
  Package, PackageCheck, Clock, Bike, Banknote, ArrowLeftRight, Wallet,
  FileText, Trash2, History, ChevronDown, ChevronRight, Lock,
  MessageSquare, MessageCircleOff, MessageCircleWarning, MessageCircleCheck,
} from 'lucide-react';
import { STATUS_LABEL, fmtCOP } from '../../lib/format';

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
}

export default function ResumenTab({ fecha, setFecha, dashboard, papeleraOrders, history, onCierreCaja }: Props) {
  const [resumenTab, setResumenTab] = useState<'activos' | 'papelera' | 'cambios'>('activos');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

  function toggleOrder(id: string) {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
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

  const filteredOrders: any[] = dashboard?.orders ?? [];

  return (
    <>
      <div className="khead">
        <div>
          <div className="ktit">Informe del día</div>
          <div className="kmeta">Tiempo real - actualización automática</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" className="fsel" value={fecha} style={{ cursor: 'pointer' }}
            onChange={(e) => setFecha(e.target.value)} />
          <button onClick={onCierreCaja}
            style={{ background: 'var(--vd)', color: '#fff', border: 'none', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
            <Lock size={15} /> Cerrar caja
          </button>
        </div>
      </div>

      {dashboard && (
        <>
          {/* Chat stats */}
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            Conversaciones WhatsApp
          </div>
          <div className="agrid">
            <div className="acard">
              <div className="ai"><MessageSquare size={26} color="var(--gt)" strokeWidth={1.5} /></div>
              <div className="av">{dashboard.chats?.total ?? 0}</div>
              <div className="al2">Chats totales</div>
            </div>
            <div className="acard" style={{ '--card-border': 'var(--brd)' } as any}>
              <div className="ai"><MessageCircleOff size={26} color="var(--gt)" strokeWidth={1.5} /></div>
              <div className="av">{dashboard.chats?.sinPedido ?? 0}</div>
              <div className="al2">Sin pedido</div>
            </div>
            <div className="acard r">
              <div className="ai"><MessageCircleWarning size={26} color="var(--r)" strokeWidth={1.5} /></div>
              <div className="av">{dashboard.chats?.activos ?? 0}</div>
              <div className="al2">Con pedidos activos</div>
            </div>
            <div className="acard v">
              <div className="ai"><MessageCircleCheck size={26} color="var(--v)" strokeWidth={1.5} /></div>
              <div className="av">{dashboard.chats?.completos ?? 0}</div>
              <div className="al2">Completados</div>
            </div>
          </div>

          {/* Order stats */}
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, marginTop: 10 }}>
            Pedidos de despacho
          </div>
          <div className="agrid">
            <div className="acard">
              <div className="ai"><Package size={26} color="var(--gt)" strokeWidth={1.5} /></div>
              <div className="av">{dashboard.totales?.total ?? 0}</div>
              <div className="al2">Pedidos totales</div>
            </div>
            <div className="acard v">
              <div className="ai"><PackageCheck size={26} color="var(--v)" strokeWidth={1.5} /></div>
              <div className="av">{dashboard.totales?.entregados ?? 0}</div>
              <div className="al2">Cerrados/Cobrados</div>
            </div>
            <div className="acard r">
              <div className="ai"><Clock size={26} color="var(--r)" strokeWidth={1.5} /></div>
              <div className="av">{dashboard.totales?.pendientes ?? 0}</div>
              <div className="al2">Pendientes</div>
            </div>
            <div className="acard az">
              <div className="ai"><Bike size={26} color="var(--az)" strokeWidth={1.5} /></div>
              <div className="av">{dashboard.totales?.domActivos ?? 0}</div>
              <div className="al2">Domicilios activos</div>
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
            <span>{filteredOrders.length} pedido{filteredOrders.length !== 1 ? 's' : ''}</span>
          </div>
          {filteredOrders.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              Sin pedidos en este estado
            </div>
          )}
          {filteredOrders.map((o: any) => {
            const total = o.items?.reduce((s: number, i: any) => s + Number(i.price), 0) ?? 0;
            const orderHist = histByOrder[o.id] ?? [];
            const isExp = expandedOrders.has(o.id);
            const col = STATUS_COLORS[o.status] ?? { bg: 'var(--bg)', fg: 'var(--gt)' };

            return (
              <div key={o.id} style={{ borderBottom: '1px solid var(--brd)' }}>
                <div
                  className="hrow hrow-exp"
                  onClick={() => toggleOrder(o.id)}
                  style={{ gridTemplateColumns: '50px 1fr auto auto auto 28px' }}
                >
                  <div className="hnum">#{o.num}</div>
                  <div>
                    <div className="hcli">{o.customer_name}</div>
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
                  <div className="ord-hist-sub">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 12px', fontSize: 13, marginBottom: orderHist.length > 0 ? 10 : 0 }}>
                      <div><span style={{ color: 'var(--gt)' }}>Teléfono: </span>{o.customer_phone ?? '—'}</div>
                      <div><span style={{ color: 'var(--gt)' }}>Pago: </span>{o.payment_method ?? '—'}</div>
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
                        {orderHist.map((h: any, i: number) => (
                          <div key={i} className="ord-hist-line">
                            <div className="ord-hist-dot" />
                            <div style={{ flex: 1 }}>
                              <span style={{ fontWeight: 700 }}>{h.actor?.name ?? 'Sistema'}</span>
                              <span style={{ color: 'var(--gt)', margin: '0 6px' }}>·</span>
                              <span>{h.field ?? h.action_type}</span>
                              {h.value_before != null && h.value_after != null && (
                                <span style={{ marginLeft: 8 }}>
                                  <span className="diff-old">− {h.value_before}</span>
                                  <span className="diff-arrow">→</span>
                                  <span className="diff-new">+ {h.value_after}</span>
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--gt)', flexShrink: 0 }}>
                              {new Date(h.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        ))}
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
              <div key={o.id} className="papcard">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>#{o.num} — {o.customer_name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Trash2 size={11} /> {new Date(o.updated_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--gt)', marginBottom: 3 }}>{o.address}</div>
                <div style={{ fontSize: 13, color: 'var(--gt)' }}>
                  {o.items?.map((i: any) => `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`).join(' · ')}
                </div>
                <div style={{ fontSize: 13, marginTop: 4, fontWeight: 700 }}>
                  {fmtCOP(total)} · {o.payment_method}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {resumenTab === 'cambios' && (
        <div style={{ padding: '4px 0' }}>
          {history.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              No hay cambios registrados
            </div>
          )}
          {history.map((h: any, i: number) => (
            <div key={i} className="elogcard">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>
                  Pedido #{h.order?.num ?? '?'} — {h.order?.customer_name ?? ''}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--a)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <History size={11} /> {new Date(h.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6, color: 'var(--n)' }}>
                {h.field ?? h.action_type}
              </div>
              {h.value_before != null && h.value_after != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
                  <span className="diff-old">− {h.value_before}</span>
                  <span className="diff-arrow">→</span>
                  <span className="diff-new">+ {h.value_after}</span>
                </div>
              )}
              {h.notes && !h.value_before && !h.value_after && (
                <div style={{ fontSize: 13, color: 'var(--gt)', marginBottom: 5 }}>{h.notes}</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--gt)' }}>Por: {h.actor?.name ?? 'Sistema'}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
