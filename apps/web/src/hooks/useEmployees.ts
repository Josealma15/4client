import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get<{ data: any[] }>('/employees').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}
