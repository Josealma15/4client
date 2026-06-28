export type OrderStatus =
  | 'nuevo'
  | 'preparando'
  | 'listo'
  | 'camino'
  | 'entregado'
  | 'cerrado'
  | 'papelera';

export type PaymentMethod = 'cash' | 'transfer' | 'cod';
export type OrderChannel = 'whatsapp' | 'call';

export interface OrderItem {
  id: string;
  order_id: string;
  product_name: string;
  quantity_label: string | null;
  price: number;
  sort_order: number;
  quantity_value: number | null;
  quantity_unit: string | null;
}

export interface OrderHistoryEntry {
  id: string;
  order_id: string;
  actor_id: string;
  actor_name: string;
  action_type: 'create' | 'edit' | 'estado' | 'cobro' | 'papelera' | 'cierre' | 'nota';
  field: string | null;
  value_before: string | null;
  value_after: string | null;
  notes: string | null;
  created_at: string;
}

export interface Order {
  id: string;
  org_id: string;
  ticket_id: string | null;
  num: string;
  customer_name: string;
  customer_phone: string | null;
  address: string;
  channel: OrderChannel;
  payment_method: PaymentMethod;
  status: OrderStatus;
  employee_id: string | null;
  employee_name: string | null;
  registered_by: string;
  registered_by_name: string;
  fecha: string;
  order_hour: string;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  amount_received: number | null;
  change_amount: number | null;
  locked: boolean;
  caja_cerrada: boolean;
  notes: string | null;
  created_at: string;
  items: OrderItem[];
  history?: OrderHistoryEntry[];
  total: number;
}
