import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { getSocket } from '../lib/socket';

export function useProducts() {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);

  // Product edits from the admin panel (ProductsSection) only touch THAT browser's
  // own react-query cache on save - every other open session (other staff mid-order,
  // or this same admin in another tab) shared the `['products']` key but is a
  // separate QueryClient, so it kept showing the stale catalog for up to staleTime
  // (5 min) with no way to know it changed. product:changed (products.ts) fixes that.
  useEffect(() => {
    if (!accessToken) return;
    const sock = getSocket(accessToken);
    const onChanged = () => qc.invalidateQueries({ queryKey: ['products'] });
    sock.on('product:changed', onChanged);
    return () => { sock.off('product:changed', onChanged); };
  }, [accessToken, qc]);

  return useQuery({
    queryKey: ['products'],
    queryFn: () => api.get<{ data: any[] }>('/products').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}
