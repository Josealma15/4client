import { STATUS_LABEL, PAYMENT_LABEL } from './format';

const DECISION_LABEL: Record<string, string> = {
  manana: 'Pasar a mañana',
  forzar_cierre: 'Cerrar sin cobro',
  '': 'Sin decidir',
};

// Shared by CierreCajaModal (live, mid-close) and ResumenTab (re-download any time
// after a day is already closed - decisions then come from the persisted
// DailyClose.decisions column via GET /dashboard, not local component state).
export function downloadCierreCSV(fecha: string, orders: any[], decisions: Record<string, string>) {
  const header = ['#', 'Cliente', 'Teléfono', 'Dirección', 'Productos', 'Total', 'Pago', 'Estado', 'Acción cierre'].join(',');
  const rows = orders.map((o) => {
    const total = o.items.reduce((s: number, i: any) => s + Number(i.price), 0);
    const productos = o.items.map((i: any) => `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`).join(' | ');
    const accion = o.paid || o.status === 'cerrado'
      ? 'Completado'
      : (DECISION_LABEL[decisions[o.id] ?? ''] ?? 'Sin decidir');
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
