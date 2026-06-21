import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useDashboard(fecha: string) {
  return useQuery({
    queryKey: ['dashboard', fecha],
    queryFn: () => api.get<{ data: any }>(`/dashboard?fecha=${fecha}`).then((r) => r.data),
  });
}
