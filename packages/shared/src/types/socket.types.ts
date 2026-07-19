import type { Order } from './order.types';
import type { TicketMessage } from './ticket.types';

export interface ServerToClientEvents {
  'order:created': (order: Order) => void;
  'order:updated': (order: Order) => void;
  'order:moved': (data: { orderId: string; newStatus: string }) => void;
  'order:paid': (data: { orderId: string }) => void;
  'ticket:message': (data: { ticketId: string; message: TicketMessage }) => void;
  'ticket:unread': (data: { ticketId: string; count: number }) => void;
  'cierre:done': (data: { fecha: string }) => void;
  'product:changed': (data: { id: string }) => void;
}

export interface ClientToServerEvents {
  'join:org': (orgId: string) => void;
  'join:date': (fecha: string) => void;
}
