import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

export default async function cierreRoutes(fastify: FastifyInstance) {
  // GET /api/v1/cierre/status?fecha=2026-06-15 - any authenticated role (encargado
  // included, unlike GET /dashboard which is admin-only) so the board can freeze a
  // past closed day into a read-only snapshot regardless of who's viewing it.
  fastify.get('/status', { preHandler: [authenticate] }, async (req, reply) => {
    const query = z.object({ fecha: z.string() }).safeParse(req.query);
    if (!query.success) return reply.status(400).send({ error: 'fecha requerida', code: 'VALIDATION_ERROR' });

    const fecha = new Date(query.data.fecha);
    const dailyClose = await fastify.prisma.dailyClose.findUnique({
      where: { org_id_fecha: { org_id: req.user.orgId, fecha } },
      select: { closed_at: true },
    });

    return reply.send({ data: { cerrado: !!dailyClose, closedAt: dailyClose?.closed_at ?? null } });
  });

  // POST /api/v1/cierre - admin y encargado
  fastify.post('/', { preHandler: [authenticate, requireRole('admin', 'encargado')] }, async (req, reply) => {
    const body = z.object({
      fecha: z.string(),
      // Only 2 real choices for a pending order at cierre time: push it to tomorrow,
      // or close it dead/unmanaged (no payment happened, nobody will chase it further).
      // "cancelar" (papelera) and "dejar_activo" (no-op) used to exist too, but gave
      // staff ways to avoid actually deciding - removed so cierre always ends with
      // every pending order in one of exactly two well-understood end states.
      decisions: z.record(z.enum(['manana', 'forzar_cierre'])),
      ticket_decisions: z.record(z.enum(['manana', 'atendido'])).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const fecha = new Date(body.data.fecha);
    const { decisions } = body.data;

    // Only TODAY can be closed - not the future (nothing to reconcile yet) and not
    // the past either: a pending order from a past day gets deferred to "tomorrow"
    // relative to THAT day, which is still a day that's already gone, not a real day
    // anyone will ever look at again - it'd defer into a dead end. Closing only ever
    // happens on the live, current day, same as the rest of the app treats "today".
    const todayLocalStr = new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0];
    if (body.data.fecha !== todayLocalStr) {
      return reply.status(400).send({
        error: 'Solo se puede cerrar la caja del día actual, no de días pasados ni futuros',
        code: 'NOT_TODAY',
      });
    }

    const yaExiste = await fastify.prisma.dailyClose.findUnique({
      where: { org_id_fecha: { org_id: req.user.orgId, fecha } },
    });
    if (yaExiste) {
      return reply.status(409).send({
        error: 'La caja de este día ya fue cerrada',
        code: 'ALREADY_CLOSED',
        closed_at: yaExiste.closed_at,
      });
    }

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

    // Whitelist of order IDs that belong to this org - prevents IDOR via crafted decisions keys
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
          // Move the whole conversation along with the order - otherwise the order
          // shows up tomorrow but its ticket doesn't, and the swimlane (which groups
          // orders under their ticket) never renders it at all.
          if (existingOrder?.ticket_id) {
            await tx.ticket.update({ where: { id: existingOrder.ticket_id }, data: { deferred_to: tomorrow } });
          }
          await tx.orderHistory.create({
            data: { org_id: req.user.orgId, order_id: orderId, actor_id: req.user.userId, action_type: 'cierre', notes: 'Movido a mañana en cierre de caja' },
          });
        } else if (decision === 'forzar_cierre') {
          // "Cerrar sin cobro" - dead/unmanaged, not a real sale. Must NOT set
          // paid/paid_at/paid_by: those mean money actually changed hands, which
          // didn't happen here. Only status+locked, so it freezes like any other
          // closed order without lying about a payment that never occurred.
          await tx.order.update({ where: { id: orderId, org_id: req.user.orgId }, data: { status: 'cerrado', locked: true } });
          await tx.orderHistory.create({
            data: { org_id: req.user.orgId, order_id: orderId, actor_id: req.user.userId, action_type: 'cierre', notes: 'Cerrado sin cobro en cierre de caja' },
          });
        }
      }

      // Procesar decisiones de tickets - validate each ticketId belongs to this org
      const ticketDecisions = body.data.ticket_decisions ?? {};
      const ticketIds = Object.keys(ticketDecisions).filter(id => id.match(/^[0-9a-f-]{36}$/i));
      const validTickets = ticketIds.length > 0
        ? await tx.ticket.findMany({ where: { id: { in: ticketIds }, org_id: req.user.orgId }, select: { id: true } })
        : [];
      const validTicketIds = new Set(validTickets.map(t => t.id));

      for (const [ticketId, tdecision] of Object.entries(ticketDecisions)) {
        if (!validTicketIds.has(ticketId)) continue;
        if (tdecision === 'manana') {
          await tx.ticket.update({ where: { id: ticketId }, data: { deferred_to: tomorrow } });
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

    // Cierre can move/close/cancel many orders and defer many tickets at once, but
    // never told anyone - no other connected staff (or even this same browser on a
    // different tab) had any signal to refetch, so "Informe del día" and the board
    // could sit showing pre-cierre numbers indefinitely.
    fastify.io.to(`org:${req.user.orgId}`).emit('cierre:done', { fecha: body.data.fecha });

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
