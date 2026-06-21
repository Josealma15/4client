import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: () => api.get<{ data: any[] }>('/products').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}
