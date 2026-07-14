import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Banknote, ArrowLeftRight, AlertTriangle, CheckCircle, Download, MessageSquare } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtCOP, STATUS_LABEL, PAYMENT_LABEL } from '../../lib/format';
import { toast } from '../ui/Toast';

interface Props {
  fecha: string;
  orders: any[];
  tickets: any[];
  onClose: () => void;
}

type Decision = 'manana' | 'forzar_cierre' | 'cancelar' | 'dejar_activo';
type TicketDecision = 'manana' | 'atendido';

export default function CierreCajaModal({ fecha, orders, tickets, onClose }: Props) {
  const qc = useQueryClient();

  // GET /orders (orders.ts) includes an order here for two different reasons: (a) its
  // real, current `fecha` is today, or (b) it's a "ghost" — already deferred AWAY from
  // today by an earlier cierre, kept only so the board can show a dimmed trace of where
  // it used to be (see Swimlane.tsx's identical isGhost logic). Only (b) should be
  // excluded here. The previous check — any `pasado_manana:` substring, regardless of
  // date — also matched orders deferred out of some OTHER, earlier day that are still
  // genuinely pending today (fecha really is today), silently hiding them from this
  // modal's decision list. cierre.ts's backend check only looks at the real `fecha`
  // column, so it still demanded a decision for them — a 400 MISSING_DECISIONS the UI
  // gave no way to fix, since the order was invisible here. Matching the marker's own
  // date against the day being closed (like Swimlane does) fixes that.
  const nonPapelera = orders.filter((o) => {
    if (o.status === 'papelera') return false;
    // notes can carry MULTIPLE pasado_manana:DATE markers (one per deferral, if an
    // order got left open two cierres in a row) — matching only the first one (old
    // behavior) missed a ghost whenever its marker wasn't first in the string. Same
    // fix as Swimlane.tsx: check every marker, not just one.
    const deferredDates = [...(o.notes?.matchAll(/pasado_manana:(\d{4}-\d{2}-\d{2})/g) ?? [])].map((m: RegExpMatchArray) => m[1]);
    const isGhost = deferredDates.includes(fecha);
    return !isGhost;
  });
  const completados = nonPapelera.filter((o) => o.paid || o.status === 'cerrado');
  const pendingOrders = nonPapelera.filter((o) => !o.paid && o.status !== 'cerrado');

  // A pending order tied to a chat drives its ticket's fate on its own — cierre.ts
  // already sets ticket.deferred_to when that order's decision is "manana" — so there's
  // no separate ticket-level decision to make for these; showing both was two decisions
  // for what's really one action. Group them: chat header, its pending order(s) indented
  // underneath with their normal per-order decision selects.
  const pendingOrdersWithTicket = pendingOrders.filter((o) => o.ticket_id);
  const pendingOrdersNoTicket = pendingOrders.filter((o) => !o.ticket_id);
  const groupedTicketIds = new Set(pendingOrdersWithTicket.map((o) => o.ticket_id));
  const ticketGroups = Array.from(groupedTicketIds).map((ticketId) => ({
    ticketId,
    ticketInfo: tickets.find((t: any) => t.id === ticketId),
    orders: pendingOrdersWithTicket.filter((o) => o.ticket_id === ticketId),
  }));

  // Chats that still need their OWN decision — nothing pending to hang it on (already
  // shown grouped above), just no order at all or unread messages to acknowledge.
  const ticketOnlyRows = tickets.filter((t: any) => {
    if (t.deferred_to) return false; // ya fue diferido antes, no mostrar de nuevo
    if (groupedTicketIds.has(t.id)) return false; // ya se muestra arriba con su pedido
    const hasNoOrders = !t.orders || t.orders.length === 0;
    const hasUnread = t.unread_count > 0;
    return hasNoOrders || hasUnread;
  });

  // No defaults — user must explicitly choose for each pending order
  const [decisions, setDecisions] = useState<Record<string, Decision | ''>>(() =>
    Object.fromEntries(pendingOrders.map((o) => [o.id, '' as Decision | '']))
  );
  const [ticketDecisions, setTicketDecisions] = useState<Record<string, TicketDecision | ''>>(() =>
    Object.fromEntries(ticketOnlyRows.map((t: any) => [t.id, '' as TicketDecision | '']))
  );

  const totalEfectivo = completados
    .filter((o: any) => ['cash', 'cod'].includes(o.payment_method))
    .reduce((s: number, o: any) => s + o.items.reduce((ss: number, i: any) => ss + Number(i.price), 0), 0);
  const totalTransferencia = completados
    .filter((o: any) => o.payment_method === 'transfer')
    .reduce((s: number, o: any) => s + o.items.reduce((ss: number, i: any) => ss + Number(i.price), 0), 0);

  const allDecided =
    pendingOrders.every((o) => decisions[o.id]) &&
    ticketOnlyRows.every((t: any) => ticketDecisions[t.id]);

  const cierreMut = useMutation({
    mutationFn: () => api.post('/cierre', {
      fecha,
      decisions: Object.fromEntries(Object.entries(decisions).filter(([, v]) => v)),
      ticket_decisions: Object.fromEntries(Object.entries(ticketDecisions).filter(([, v]) => v)),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['cierre-status'] });
      toast('Caja cerrada correctamente');
      onClose();
    },
    onError: (e: any) => {
      if (e.code === 'MISSING_DECISIONS' && Array.isArray(e.data?.pending) && e.data.pending.length > 0) {
        const nums = e.data.pending.map((p: any) => `#${p.num} (${p.customer_name})`).join(', ');
        toast(`Faltan decisiones: ${nums}`, true);
        return;
      }
      if (e.code === 'ALREADY_CLOSED') {
        toast('Ya cerraste caja para este día', true);
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        onClose();
        return;
      }
      toast(e.message ?? 'Error al cerrar caja', true);
    },
  });

  function downloadCSV() {
    const decisionLabel: Record<string, string> = {
      manana: 'Pasar a mañana',
      forzar_cierre: 'Cerrar sin cobro',
      cancelar: 'Papelera',
      dejar_activo: 'Dejado activo (sin cambios)',
      '': 'Sin decidir',
    };
    const header = ['#', 'Cliente', 'Teléfono', 'Dirección', 'Productos', 'Total', 'Pago', 'Estado', 'Acción cierre'].join(',');
    const rows = nonPapelera.map((o) => {
      const total = o.items.reduce((s: number, i: any) => s + Number(i.price), 0);
      const productos = o.items.map((i: any) => `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`).join(' | ');
      const accion = o.paid || o.status === 'cerrado'
        ? 'Completado'
        : decisionLabel[decisions[o.id] ?? ''];
      return [
        o.num,
        `"${o.customer_name}"`,
        o.customer_phone ?? '',
        `"${o.address}"`,
        `"${productos}"`,
        total,
        PAYMENT_LABEL[o.payment_method] ?? o.payment_method,
        STATUS_LABEL[o.status] ?? o.status,
        accion,
      ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Cierre_${fecha}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pendingSinDecision = pendingOrders.filter((o) => !decisions[o.id]).length;

  return (
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cierre-win">
        <div className="mhead">
          <div>
            <div className="mtit" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Lock size={18} color="var(--vd)" /> Cierre de caja
            </div>
            <div className="msub">{fecha}</div>
          </div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="mbody">
          <div className="cierre-sect">
            <div className="cierre-stit">Resumen de ventas</div>
            <div className="cierre-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Banknote size={15} color="var(--v)" /> Efectivo + Cobro en casa
              </span>
              <span style={{ fontWeight: 800 }}>{fmtCOP(totalEfectivo)}</span>
            </div>
            <div className="cierre-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <ArrowLeftRight size={15} color="var(--az)" /> Transferencia
              </span>
              <span style={{ fontWeight: 800 }}>{fmtCOP(totalTransferencia)}</span>
            </div>
            <div className="cierre-total">
              <span>Total recaudado</span>
              <span>{fmtCOP(totalEfectivo + totalTransferencia)}</span>
            </div>
          </div>

          {completados.length > 0 && (
            <div className="cierre-sect">
              <div className="cierre-stit" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle size={13} color="var(--v)" />
                Pedidos completados ({completados.length})
              </div>
              {completados.map((o) => {
                const total = o.items.reduce((s: number, i: any) => s + Number(i.price), 0);
                return (
                  <div key={o.id} className="warn-ord" style={{ opacity: 0.75 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>#{o.num} - {o.customer_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--gt)' }}>
                        {STATUS_LABEL[o.status] ?? o.status} · {fmtCOP(total)}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--v)', background: 'var(--vc)', padding: '4px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <CheckCircle size={12} /> Completado
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {(ticketGroups.length > 0 || ticketOnlyRows.length > 0 || pendingOrdersNoTicket.length > 0) ? (
            <div className="cierre-sect">
              <div className="cierre-stit" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={13} color="var(--a)" />
                Pedidos y chats pendientes - decide qué hacer ({pendingOrders.length + ticketOnlyRows.length})
                <button
                  className="bsec"
                  style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                  onClick={() => {
                    const all: Record<string, Decision> = {};
                    for (const o of pendingOrders) all[o.id] = 'manana';
                    setDecisions(prev => ({ ...prev, ...all }));
                  }}
                >
                  Pasar todo a mañana
                </button>
              </div>
              {pendingSinDecision > 0 && (
                <div style={{ background: 'var(--ac)', border: '1px solid var(--a)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13, color: 'var(--a)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <AlertTriangle size={13} /> {pendingSinDecision} pedido{pendingSinDecision !== 1 ? 's' : ''} sin decisión
                </div>
              )}

              {/* Chat + su(s) pedido(s) pendiente(s) indentados debajo — una sola decisión
                  (la del pedido) mueve ambos, cierre.ts ya difiere el ticket junto con él. */}
              {ticketGroups.map(({ ticketId, ticketInfo, orders: tOrders }) => (
                <div key={ticketId} className="warn-ord" style={{ flexDirection: 'column', alignItems: 'stretch', borderLeft: '3px solid var(--az)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <MessageSquare size={13} color="var(--az)" />
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      {ticketInfo?.customer_name ?? tOrders[0].customer_name} - {ticketInfo?.phone ?? tOrders[0].customer_phone ?? ''}
                    </div>
                    {ticketInfo?.unread_count > 0 && (
                      <span style={{ color: 'var(--az)', fontWeight: 700, fontSize: 12 }}>{ticketInfo.unread_count} sin leer</span>
                    )}
                  </div>
                  <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: '2px solid var(--brd)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tOrders.map((o) => {
                      const total = o.items.reduce((s: number, i: any) => s + Number(i.price), 0);
                      const hasDecision = !!decisions[o.id];
                      return (
                        <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>#{o.num}</div>
                            <div style={{ fontSize: 12, color: 'var(--gt)' }}>
                              {STATUS_LABEL[o.status] ?? o.status} · {fmtCOP(total)}
                            </div>
                          </div>
                          <select
                            className="warn-sel"
                            value={decisions[o.id] ?? ''}
                            onChange={(e) => setDecisions({ ...decisions, [o.id]: e.target.value as Decision | '' })}
                            style={{ borderColor: hasDecision ? 'var(--v)' : 'var(--a)' }}
                          >
                            <option value="" disabled>— Elegir acción —</option>
                            <option value="dejar_activo">Dejar activo (sin cambios)</option>
                            <option value="manana">Pasar a mañana</option>
                            <option value="forzar_cierre">Cerrar sin cobro</option>
                            <option value="cancelar">Enviar a papelera</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Chats sin pedido pendiente que igual necesitan una decisión propia
                  (sin pedido, o con mensajes sin leer) */}
              {ticketOnlyRows.map((t: any) => {
                const hasDecision = !!ticketDecisions[t.id];
                const hasNoOrders = !t.orders || t.orders.length === 0;
                return (
                  <div key={t.id} className="warn-ord" style={{ borderLeft: hasDecision ? '3px solid var(--v)' : '3px solid var(--az)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{t.customer_name} - {t.phone}</div>
                      <div style={{ fontSize: 12, color: 'var(--gt)' }}>
                        {hasNoOrders ? 'Sin pedido' : 'Pedidos completados'}
                        {t.unread_count > 0 && <span style={{ marginLeft: 8, color: 'var(--az)', fontWeight: 700 }}>{t.unread_count} sin leer</span>}
                      </div>
                    </div>
                    <select
                      className="warn-sel"
                      value={ticketDecisions[t.id] ?? ''}
                      onChange={(e) => setTicketDecisions({ ...ticketDecisions, [t.id]: e.target.value as TicketDecision | '' })}
                      style={{ borderColor: hasDecision ? 'var(--v)' : 'var(--az)' }}
                    >
                      <option value="" disabled>— Elegir acción —</option>
                      <option value="manana">Pasar a mañana</option>
                      <option value="atendido">Marcar como atendido</option>
                    </select>
                  </div>
                );
              })}

              {/* Pedidos sin chat asociado (llamada/en persona) — no hay ticket bajo el cual agrupar */}
              {pendingOrdersNoTicket.map((o) => {
                const total = o.items.reduce((s: number, i: any) => s + Number(i.price), 0);
                const hasDecision = !!decisions[o.id];
                return (
                  <div key={o.id} className="warn-ord" style={{ borderLeft: hasDecision ? '3px solid var(--v)' : '3px solid var(--a)' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>#{o.num} - {o.customer_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--gt)' }}>
                        {STATUS_LABEL[o.status] ?? o.status} · {fmtCOP(total)}
                      </div>
                    </div>
                    <select
                      className="warn-sel"
                      value={decisions[o.id] ?? ''}
                      onChange={(e) => setDecisions({ ...decisions, [o.id]: e.target.value as Decision | '' })}
                      style={{ borderColor: hasDecision ? 'var(--v)' : 'var(--a)' }}
                    >
                      <option value="" disabled>— Elegir acción —</option>
                      <option value="dejar_activo">Dejar activo (sin cambios)</option>
                      <option value="manana">Pasar a mañana</option>
                      <option value="forzar_cierre">Cerrar sin cobro</option>
                      <option value="cancelar">Enviar a papelera</option>
                    </select>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ background: 'var(--vc)', borderRadius: 'var(--rad)', padding: '12px 16px', marginBottom: 14, fontSize: 13, fontWeight: 700, color: 'var(--vd)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={15} /> Todos los pedidos y chats están resueltos.
            </div>
          )}

          {!allDecided && (pendingOrders.length > 0 || ticketOnlyRows.length > 0) && (
            <div style={{ background: 'var(--ac)', border: '1px solid var(--a)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--a)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} /> Decide la acción de cada pedido y chat pendiente para poder cerrar o descargar el informe.
            </div>
          )}

          <div className="mactions">
            <button className="bsec" onClick={onClose}>Cancelar</button>
            <button className="bsec" onClick={downloadCSV} disabled={!allDecided}
              title={!allDecided ? 'Decide la acción de cada pedido pendiente primero' : ''}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: allDecided ? 1 : 0.5 }}>
              <Download size={14} /> CSV
            </button>
            <button className="bpri" onClick={() => cierreMut.mutate()} disabled={cierreMut.isPending || !allDecided}
              title={!allDecided ? 'Decide la acción de cada pedido pendiente primero' : ''}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              {cierreMut.isPending ? 'Cerrando...' : <><Lock size={14} /> Cerrar caja</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
