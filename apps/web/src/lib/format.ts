export function fmtCOP(n: number): string {
  return '$' + n.toLocaleString('es-CO');
}

export function fmtDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<string, string> = {
  nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo',
  camino: 'En camino', entregado: 'Entregado', cerrado: 'Cerrado',
};

export const STATUS_ORDER = ['nuevo', 'preparando', 'listo', 'camino', 'entregado', 'cerrado'];

export const PAYMENT_LABEL: Record<string, string> = {
  cod: 'Cobro en casa', cash: 'Efectivo', transfer: 'Transferencia', sin_asignar: 'Sin asignar',
};
