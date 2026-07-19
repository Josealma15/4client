import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useDashboard(fecha: string, enabled = true) {
  return useQuery({
    queryKey: ['dashboard', fecha],
    queryFn: () => api.get<{ data: any }>(`/dashboard?fecha=${fecha}`).then((r) => r.data),
    // GET /dashboard is admin-only server-side (requireRole('admin')) — without this
    // gate, any non-admin session (encargado/domiciliario) polled it every 30s
    // forever and got a 403 on every single attempt, for nothing.
    enabled,
    // Fallback only - real-time delivery is via socket (order:*, ticket:*, cierre:done
    // events in MainPage), but a missed event shouldn't leave "Informe del día"
    // showing stale numbers for longer than this.
    refetchInterval: 30000,
  });
}
