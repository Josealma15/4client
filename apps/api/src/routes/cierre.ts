import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

export default async function cierreRoutes(fastify: FastifyInstance) {
  // POST /api/v1/cierre — admin y encargado
  fastify.post('/', { preHandler: [authenticate, requireRole('admin', 'encargado')] }, async (req, reply) => {
    const body = z.object({
      fecha: z.string(),
      decisions: z.record(z.enum(['manana', 'forzar_cierre', 'cancelar'])),
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

    // Aplicar decisiones y cerrar caja en transacción
    await fastify.prisma.$transaction(async (tx) => {
      for (const [orderId, decision] of Object.entries(decisions)) {
        if (decision === 'manana') {
          await tx.order.update({ where: { id: orderId }, data: { fecha: tomorrow, notes: `pasado_manana:${fechaStr}` } });
          await tx.orderHistory.create({
            data: { org_id: req.user.orgId, order_id: orderId, actor_id: req.user.userId, action_type: 'cierre', notes: 'Movido a mañana en cierre de caja' },
          });
        } else if (decision === 'cancelar') {
          await tx.order.update({ where: { id: orderId }, data: { status: 'papelera' } });
          await tx.orderHistory.create({
            data: { org_id: req.user.orgId, order_id: orderId, actor_id: req.user.userId, action_type: 'cierre', notes: 'Cancelado en cierre de caja' },
          });
        } else if (decision === 'forzar_cierre') {
          await tx.order.update({ where: { id: orderId }, data: { status: 'cerrado', paid: true, locked: true, paid_at: new Date(), paid_by: req.user.userId } });
          await tx.orderHistory.create({
            data: { org_id: req.user.orgId, order_id: orderId, actor_id: req.user.userId, action_type: 'cierre', notes: 'Cierre forzado por admin en cierre de caja' },
          });
        }
      }

      // Procesar decisiones de tickets
      const ticketDecisions = body.data.ticket_decisions ?? {};
      for (const [ticketId, tdecision] of Object.entries(ticketDecisions)) {
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
