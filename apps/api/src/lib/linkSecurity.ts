import type { PrismaClient } from '@prisma/client';

// Wrong-PIN abuse ladder, shared by public.ts (form links) and files.ts (invoice
// links) and scoped to the TICKET, not to one specific token/filename - a wrong
// guess on the form link and a wrong guess on a factura link count toward the
// exact same counters, and hitting the soft limit locks BOTH kinds of link for
// that chat, not just whichever one the guesses happened to land on.
//
// Soft limit (10): every outstanding link for the ticket - the form link AND any
// invoice link - stops working. Recoverable any time staff sends a fresh link of
// EITHER kind (clearSoftLinkBlock, called from inbox.ts's /form-link route and
// files.ts's POST /invoice).
//
// Hard limit (30, cumulative across soft-limit resets): the whole chat is locked
// for TICKET_BLOCK_HOURS, self-expiring - no staff action can lift it early, which
// is what actually stops someone from dodging the soft limit forever by just
// asking staff for one more link every 10 guesses.
export const MAX_ATTEMPTS_SOFT = 10;
export const MAX_ATTEMPTS_HARD = 30;
export const TICKET_BLOCK_HOURS = 24;

// Call on every wrong phone_last4 guess for a ticket, from either link type.
export async function registerFailedLinkAttempt(prisma: PrismaClient, ticketId: string): Promise<void> {
  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { link_failed_attempts: { increment: 1 }, link_failed_total: { increment: 1 } },
    select: { link_failed_total: true },
  });
  if (updated.link_failed_total >= MAX_ATTEMPTS_HARD) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { link_failed_attempts: 0, link_failed_total: 0, link_blocked_until: new Date(Date.now() + TICKET_BLOCK_HOURS * 3600000) },
    });
  }
}

// Call whenever staff issues a fresh link for a ticket (form or factura) - a
// deliberate "give them another chance" action. Only clears the SOFT count -
// link_failed_total (and any active hard block) is untouched, so this can't be
// used to dodge the 24h lock by just resending a link.
export async function clearSoftLinkBlock(prisma: PrismaClient, ticketId: string): Promise<void> {
  await prisma.ticket.update({ where: { id: ticketId }, data: { link_failed_attempts: 0 } });
}
