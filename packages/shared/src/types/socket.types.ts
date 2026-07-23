import type { Order } from './order.types';
import type { TicketMessage } from './ticket.types';

export interface ServerToClientEvents {
  'order:created': (order: Order) => void;
  'order:updated': (order: Order) => void;
  'order:moved': (data: { orderId: string; newStatus: string }) => void;
  'order:paid': (data: { orderId: string }) => void;
  'ticket:message': (data: { ticketId: string; message: TicketMessage }) => void;
  // Fired when Meta reports a delivery/read/failure update for a message already
  // shown in the UI - a separate, lightweight event instead of re-sending the whole
  // TicketMessage, since only these three fields ever change after the message
  // itself was created (webhook.ts's statuses handling).
  'ticket:message-status': (data: { ticketId: string; messageId: string; delivered: boolean; read_by_client: boolean; failed_reason: string | null }) => void;
  'ticket:unread': (data: { ticketId: string; count: number }) => void;
  'cierre:done': (data: { fecha: string }) => void;
  'product:changed': (data: { id: string }) => void;
}

export interface ClientToServerEvents {
  'join:org': (orgId: string) => void;
  'join:date': (fecha: string) => void;
}
