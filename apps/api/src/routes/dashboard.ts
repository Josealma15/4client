import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

export default async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/v1/dashboard?fecha=2026-06-15 — solo admin
  fastify.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const query = z.object({ fecha: z.string().optional() }).parse(req.query);
    const fecha = query.fecha ? new Date(query.fecha) : new Date();

    const [orders, papeleraOrders, history, tickets] = await Promise.all([
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
        where: { org_id: req.user.orgId, fecha },
        include: {
          orders: {
            where: { status: { not: 'papelera' } },
            select: { status: true, paid: true },
          },
        },
      }),
    ]);

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
    const totalChats = tickets.length;
    const chatsSinPedido = tickets.filter(t => t.orders.length === 0).length;
    const chatsCompletos = tickets.filter(t =>
      t.orders.length > 0 && t.orders.every(o => o.paid || o.status === 'cerrado')
    ).length;
    const chatsActivos = tickets.filter(t =>
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
      },
    });
  });
}
