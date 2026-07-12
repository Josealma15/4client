import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useOrders(fecha: string) {
  return useQuery({
    queryKey: ['orders', fecha],
    queryFn: () => api.get<{ data: any[] }>(`/orders?fecha=${fecha}`).then((r) => r.data),
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post<{ data: any }>('/orders', body).then((r) => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['orders', vars.fecha] });
      qc.invalidateQueries({ queryKey: ['tickets'] }); // re-link order into ticket row immediately
    },
  });
}

export function usePatchOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch<{ data: any }>(`/orders/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export function useMoveOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch<{ data: any }>(`/orders/${id}/status`, { status }).then((r) => r.data),
    // Optimistic update: apply the new status to the cached list immediately so the
    // card jumps columns on drop instead of waiting for a full round-trip + refetch
    // (which is what made moving an order feel ~2s slow).
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['orders'] });
      const previous = qc.getQueriesData({ queryKey: ['orders'] });
      qc.setQueriesData({ queryKey: ['orders'] }, (old: any) =>
        Array.isArray(old)
          ? old.map((o: any) => (o.id === id ? { ...o, status } : o))
          : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]: any) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export function useCobroOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => api.post<{ data: any }>(`/orders/${id}/cobro`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}
