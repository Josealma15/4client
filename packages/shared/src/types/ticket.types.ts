export type MessageDirection = 'in' | 'out';
export type MediaType = 'pdf' | 'image' | 'audio' | 'video';

export interface TicketMessage {
  id: string;
  ticket_id: string;
  direction: MessageDirection;
  text: string | null;
  media_url: string | null;
  media_type: MediaType | null;
  media_caption: string | null;
  sent_by: string | null;
  sent_by_name: string | null;
  wpp_message_id: string | null;
  sent_at: string;
  delivered: boolean;
  read_by_client: boolean;
  failed_reason: string | null;
}

export interface Ticket {
  id: string;
  org_id: string;
  phone: string;
  customer_name: string | null;
  unread_count: number;
  last_message_at: string | null;
  fecha: string;
  created_at: string;
  order_ids: string[];
  last_message?: TicketMessage;
}
