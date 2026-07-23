import { Check, CheckCheck, AlertCircle } from 'lucide-react';

interface Props {
  delivered?: boolean;
  read_by_client?: boolean;
  failed_reason?: string | null;
}

// Shared by every place an outbound WhatsApp message is rendered (TicketModal,
// InboxPanel) - a single check mark until Meta confirms delivery (webhook.ts's
// ingestStatus), a double check once delivered, blue once the client actually reads
// it, or a red warning if Meta reported it never arrived at all (wrong number,
// blocked the business, phone not on WhatsApp...). Matches the same three-state
// convention WhatsApp's own client uses, so it reads instantly to anyone who's used
// WhatsApp before.
export default function DeliveryStatus({ delivered, read_by_client, failed_reason }: Props) {
  if (failed_reason) {
    return <span title={`No se pudo entregar: ${failed_reason}`}><AlertCircle size={12} color="#DC2626" /></span>;
  }
  if (read_by_client) {
    return <span title="Leído"><CheckCheck size={13} color="#34B7F1" /></span>;
  }
  if (delivered) {
    return <span title="Entregado"><CheckCheck size={13} color="#999" /></span>;
  }
  return <span title="Enviado"><Check size={13} color="#999" /></span>;
}
