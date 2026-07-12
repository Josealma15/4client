import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useDashboard(fecha: string) {
  return useQuery({
    queryKey: ['dashboard', fecha],
    queryFn: () => api.get<{ data: any }>(`/dashboard?fecha=${fecha}`).then((r) => r.data),
    // Fallback only — real-time delivery is via socket (order:*, ticket:*, cierre:done
    // events in MainPage), but a missed event shouldn't leave "Informe del día"
    // showing stale numbers for longer than this.
    refetchInterval: 30000,
  });
}
