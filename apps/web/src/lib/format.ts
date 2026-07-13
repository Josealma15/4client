export function fmtCOP(n: number): string {
  return '$' + n.toLocaleString('es-CO');
}

export function fmtDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Bogota' });
}

// Colombia's calendar date (UTC-5, no DST) for an instant — NOT the device's own local
// date. Using the device's local getters (new Date().getFullYear() etc.) only happens
// to be correct if the device's own timezone is set to Bogotá; on any other timezone
// (or just a misconfigured device) "today" could read as the wrong day, off by one
// around the boundary — which is exactly what shifts a Saturday into showing as Sunday.
export function colombiaDateStr(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const col = new Date(date.getTime() - 5 * 3600000);
  return `${col.getUTCFullYear()}-${String(col.getUTCMonth() + 1).padStart(2, '0')}-${String(col.getUTCDate()).padStart(2, '0')}`;
}

export function todayStr(): string {
  return colombiaDateStr();
}

export const STATUS_LABEL: Record<string, string> = {
  nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo',
  camino: 'En camino', entregado: 'Entregado', cerrado: 'Cerrado',
};

export const STATUS_ORDER = ['nuevo', 'preparando', 'listo', 'camino', 'entregado', 'cerrado'];

export const PAYMENT_LABEL: Record<string, string> = {
  cod: 'Cobro en casa', cash: 'Efectivo', transfer: 'Transferencia', sin_asignar: 'Sin asignar',
};
