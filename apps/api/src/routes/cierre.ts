import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth.js';

// Defers a ticket to `tomorrow` — unless the same customer already texted again on
// that date before this cierre ran. In that case the webhook (which only ever checks
// for an exact fecha match or an already-deferred ticket) had no way to know this
// ticket was about to land on the same day, so it opened a second ticket for that
// phone+day. Left alone, the order/ticket being deferred here would keep pointing at
// the old (now dead-end) ticket forever while every new incoming message accumulates
// on the other one — exactly the "messages only show in Chats WPP, not in Pedidos /
// Ver conversación" split. Merge into the ticket that already exists instead of
// creating that fork.
async function deferOrMergeTicket(
  tx: Prisma.TransactionClient,
  orgId: string,
  ticketId: string,
  tomorrow: Date,
) {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, select: { phone: true, unread_count: true } });
  if (!ticket) return; // already merged away by an earlier iteration in this same cierre run

  const landed = await tx.ticket.findFirst({
    where: { org_id: orgId, phone: ticket.phone, fecha: tomorrow, NOT: { id: ticketId } },
  });

  if (!landed) {
    await tx.ticket.update({ where: { id: ticketId }, data: { deferred_to: tomorrow } });
    return;
  }

  await tx.ticketMessage.updateMany({ where: { ticket_id: ticketId }, data: { ticket_id: landed.id } });
  await tx.order.updateMany({ where: { ticket_id: ticketId }, data: { ticket_id: landed.id } });
  await tx.ticket.update({ where: { id: landed.id }, data: { unread_count: { increment: ticket.unread_count } } });
  await tx.ticket.delete({ where: { id: ticketId } });
}

export default async function cierreRoutes(fastify: FastifyInstance) {
  // POST /api/v1/cierre — admin y encargado
  fastify.post('/', { preHandler: [authenticate, requireRole('admin', 'encargado')] }, async (req, reply) => {
    const body = z.object({
      fecha: z.string(),
      decisions: z.record(z.enum(['manana', 'forzar_cierre', 'cancelar', 'dejar_activo'])),
      ticket_decisions: z.record(z.enum(['manana', 'atendido'])).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const fecha = new Date(body.data.fecha);
    const { decisions } = body.data;

    const pendientes = await fastify.prisma.order.findMany({
      where: { org_id: req.user.orgId, fecha, paid: false, status: { notIn: ['cerrado', 'papelera'] } },
      include: { items: true },
    });

    // Verificar que todos los pendientes tienen decisión
    const sinDecision = pendientes.filter(p => !decisions[p.id]);
    if (sinDecision.length > 0) {
      return reply.status(400).send({
        error: 'Todos los pedidos pendientes requieren una decisión',
        code: 'MISSING_DECISIONS',
        pending: sinDecision.map(p => ({ id: p.id, num: p.num, customer_name: p.customer_name })),
      });
    }

    // Calcular totales
    const todosPagados = await fastify.prisma.order.findMany({
      where: { org_id: req.user.orgId, fecha, paid: true },
      include: { items: true },
    });

    let totalEfectivo = 0;
    let totalTransferencia = 0;
    todosPagados.forEach(o => {
      const tot = o.items.reduce((s, i) => s + Number(i.price), 0);
      if (o.payment_method === 'cash' || o.payment_method === 'cod') totalEfectivo += tot;
      else if (o.payment_method === 'transfer') totalTransferencia += tot;
    });

    const tomorrow = new Date(fecha);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const fechaStr = fecha.toISOString().split('T')[0];

    // Whitelist of order IDs that belong to this org — prevents IDOR via crafted decisions keys
    const validOrderIds = new Set(pendientes.map(p => p.id));

    // Aplicar decisiones y cerrar caja en transacción
    await fastify.prisma.$transaction(async (tx) => {
      for (const [orderId, decision] of Object.entries(decisions)) {
        // Skip any IDs not from this org's pendientes list
        if (!validOrderIds.has(orderId)) continue;

        if (decision === 'manana') {
          const existingOrder = pendientes.find(p => p.id === orderId);
          const marker = `pasado_manana:${fechaStr}`;
          const newNotes = existingOrder?.notes ? `${existingOrder.notes}\n${marker}` : marker;
          await tx.order.update({ where: { id: orderId, org_id: req.user.orgId }, data: { fecha: tomorrow, notes: newNotes } });
          // Move the whole conversation along with the order — otherwise the order
          // shows up tomorrow but its ticket doesn't, and the swimlane (which groups
          // orders under their ticket) never renders it at all.
          if (existingOrder?.ticket_id) {
            await deferOrMergeTicket(tx, req.user.orgId, existingOrder.ticket_id, tomorrow);
          }
          await tx.orderHistory.create({
            data: { org_id: req.user.orgId, order_id: orderId, actor_id: req.user.userId, action_type: 'cierre', notes: 'Movido a mañana en cierre de caja' },
          });
        } else if (decision === 'cancelar') {
          await tx.order.update({ where: { id: orderId, org_id: req.user.orgId }, data: { status: 'papelera' } });
          await tx.orderHistory.create({
            data: { org_id: req.user.orgId, order_id: orderId, actor_id: req.user.userId, action_type: 'cierre', notes: 'Cancelado en cierre de caja' },
          });
        } else if (decision === 'forzar_cierre') {
          await tx.order.update({ where: { id: orderId, org_id: req.user.orgId }, data: { status: 'cerrado', paid: true, locked: true, paid_at: new Date(), paid_by: req.user.userId } });
          await tx.orderHistory.create({
            data: { org_id: req.user.orgId, order_id: orderId, actor_id: req.user.userId, action_type: 'cierre', notes: 'Cierre forzado por admin en cierre de caja' },
          });
        } else if (decision === 'dejar_activo') {
          // No changes at all — order stays exactly as it is (same fecha, same status).
          // Just an explicit acknowledgment so cierre can proceed without forcing an
          // in-progress order (e.g. still "camino") into a fake close or a date it
          // hasn't actually rolled into yet.
          await tx.orderHistory.create({
            data: { org_id: req.user.orgId, order_id: orderId, actor_id: req.user.userId, action_type: 'cierre', notes: 'Dejado activo (sin cambios) en cierre de caja' },
          });
        }
      }

      // Procesar decisiones de tickets — validate each ticketId belongs to this org
      const ticketDecisions = body.data.ticket_decisions ?? {};
      const ticketIds = Object.keys(ticketDecisions).filter(id => id.match(/^[0-9a-f-]{36}$/i));
      const validTickets = ticketIds.length > 0
        ? await tx.ticket.findMany({ where: { id: { in: ticketIds }, org_id: req.user.orgId }, select: { id: true } })
        : [];
      const validTicketIds = new Set(validTickets.map(t => t.id));

      for (const [ticketId, tdecision] of Object.entries(ticketDecisions)) {
        if (!validTicketIds.has(ticketId)) continue;
        if (tdecision === 'manana') {
          await deferOrMergeTicket(tx, req.user.orgId, ticketId, tomorrow);
        } else if (tdecision === 'atendido') {
          await tx.ticket.update({ where: { id: ticketId }, data: { unread_count: 0 } });
        }
      }

      // Marcar todos los pedidos del día como caja cerrada
      await tx.order.updateMany({ where: { org_id: req.user.orgId, fecha }, data: { caja_cerrada: true } });

      const allOrders = await tx.order.count({ where: { org_id: req.user.orgId, fecha, status: { not: 'papelera' } } });
      const closedOrders = await tx.order.count({ where: { org_id: req.user.orgId, fecha, status: 'cerrado' } });

      await tx.dailyClose.upsert({
        where: { org_id_fecha: { org_id: req.user.orgId, fecha } },
        update: {
          total_cash: totalEfectivo, total_transfer: totalTransferencia,
          total_grand: totalEfectivo + totalTransferencia,
          total_orders: allOrders, closed_orders: closedOrders,
          decisions: decisions as any, closed_by: req.user.userId, closed_at: new Date(),
        },
        create: {
          org_id: req.user.orgId, fecha,
          total_cash: totalEfectivo, total_transfer: totalTransferencia,
          total_grand: totalEfectivo + totalTransferencia,
          total_orders: allOrders, closed_orders: closedOrders,
          decisions: decisions as any, closed_by: req.user.userId,
        },
      });
    });

    return reply.send({
      data: {
        fecha: body.data.fecha,
        total_cash: totalEfectivo,
        total_transfer: totalTransferencia,
        total_grand: totalEfectivo + totalTransferencia,
      },
    });
  });
}
