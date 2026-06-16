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
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['orders', vars.fecha] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}

export function useCobroOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => api.post<{ data: any }>(`/orders/${id}/cobro`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}
