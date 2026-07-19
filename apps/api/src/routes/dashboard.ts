import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

export default async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/v1/dashboard?fecha=2026-06-15 - solo admin
  fastify.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const query = z.object({ fecha: z.string().optional() }).parse(req.query);
    const fecha = query.fecha ? new Date(query.fecha) : new Date();

    const [orders, papeleraOrders, history, tickets, dailyClose] = await Promise.all([
      fastify.prisma.order.findMany({
        where: { org_id: req.user.orgId, fecha, status: { not: 'papelera' } },
        include: { items: true, employee: { select: { id: true, name: true } } },
      }),
      fastify.prisma.order.findMany({
        where: { org_id: req.user.orgId, fecha, status: 'papelera' },
        include: { items: true },
      }),
      fastify.prisma.orderHistory.findMany({
        where: { org_id: req.user.orgId, order: { fecha } },
        include: {
          actor: { select: { id: true, name: true } },
          order: { select: { num: true, customer_name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 300,
      }),
      fastify.prisma.ticket.findMany({
        // Same resolution as GET /tickets (the swimlane board) - a ticket whose order
        // was deferred to another day only gets `deferred_to` set, its own `fecha`
        // stays put, so a plain `{ fecha }` match here silently dropped it from
        // whichever day it actually landed on and left it double-counted on the day
        // it left, undercounting/overcounting "chats completados" around any deferral.
        where: {
          org_id: req.user.orgId,
          OR: [
            { fecha },
            { deferred_to: fecha },
            { orders: { some: { fecha } } },
          ],
        },
        include: {
          // Scoped to `fecha` too, not just non-papelera - a ticket is now one row
          // per phone forever (not per day), so without this it pulls in EVERY order
          // that ticket has ever had across its whole history. A chat whose 3 orders
          // today are all paid+cerrado was still coming back "activo" here because
          // some unrelated order from a different day, sitting on the same ticket,
          // wasn't closed - this is what "chats completados"/"con pedido activo"
          // meant to reflect right now, today, not the ticket's entire lifetime.
          orders: {
            where: { status: { not: 'papelera' }, fecha },
            select: { status: true, paid: true },
          },
        },
        orderBy: { created_at: 'asc' },
      }),
      fastify.prisma.dailyClose.findUnique({
        where: { org_id_fecha: { org_id: req.user.orgId, fecha } },
        include: { closedBy: { select: { name: true } } },
      }),
    ]);

    // Same phone dedup as GET /tickets - belt-and-suspenders now that a phone can
    // only ever have one ticket row (@@unique(org_id, phone) on Ticket).
    const seenPhones = new Set<string>();
    const tickets_ = tickets.filter(t => {
      if (seenPhones.has(t.phone)) return false;
      seenPhones.add(t.phone);
      return true;
    });

    // Order stats
    const total = orders.length;
    const cerrados = orders.filter(o => o.status === 'cerrado').length;
    const pendientes = orders.filter(o => o.status !== 'cerrado').length;
    const domActivos = orders.filter(o =>
      ['preparando', 'listo', 'camino'].includes(o.status) && o.employee_id
    ).length;

    let totalEfectivo = 0;
    let totalTransferencia = 0;
    orders.filter(o => o.paid).forEach(o => {
      const tot = o.items.reduce((s, i) => s + Number(i.price), 0);
      if (o.payment_method === 'cash' || o.payment_method === 'cod') totalEfectivo += tot;
      else if (o.payment_method === 'transfer') totalTransferencia += tot;
    });

    // Chat stats
    const totalChats = tickets_.length;
    const chatsSinPedido = tickets_.filter(t => t.orders.length === 0).length;
    const chatsCompletos = tickets_.filter(t =>
      t.orders.length > 0 && t.orders.every(o => o.paid || o.status === 'cerrado')
    ).length;
    const chatsActivos = tickets_.filter(t =>
      t.orders.some(o => !o.paid && o.status !== 'cerrado')
    ).length;

    return reply.send({
      data: {
        totales: { total, entregados: cerrados, pendientes, domActivos },
        chats: { total: totalChats, sinPedido: chatsSinPedido, activos: chatsActivos, completos: chatsCompletos },
        recaudado: {
          efectivo: totalEfectivo,
          transferencia: totalTransferencia,
          total: totalEfectivo + totalTransferencia,
        },
        orders,
        papeleraOrders,
        history,
        cierre: dailyClose ? { cerrado: true, closedAt: dailyClose.closed_at, closedByName: dailyClose.closedBy?.name ?? null } : { cerrado: false },
      },
    });
  });
}
