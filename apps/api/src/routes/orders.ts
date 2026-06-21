import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

const createOrderSchema = z.object({
  ticket_id:      z.string().uuid().optional(),
  customer_name:  z.string().min(1),
  customer_phone: z.string().optional(),
  address:        z.string().min(1),
  channel:        z.enum(['whatsapp', 'call']).default('whatsapp'),
  payment_method: z.enum(['cash', 'transfer', 'cod']),
  employee_id:    z.string().uuid().optional(),
  notes:          z.string().optional(),
  fecha:          z.string().optional(),
  items: z.array(z.object({
    product_name:   z.string().min(1),
    quantity_label: z.string().optional(),
    price:          z.number().min(0),
    sort_order:     z.number().default(0),
  })),
});

const updateOrderSchema = z.object({
  customer_name:  z.string().optional(),
  customer_phone: z.string().optional(),
  address:        z.string().optional(),
  payment_method: z.enum(['cash', 'transfer', 'cod']).optional(),
  employee_id:    z.string().uuid().nullable().optional(),
  notes:          z.string().optional(),
  items: z.array(z.object({
    product_name:   z.string().min(1),
    quantity_label: z.string().optional(),
    price:          z.number().min(0),
    sort_order:     z.number().default(0),
  })).optional(),
});

function buildOrderSelect(includeHistory = false) {
  return {
    id: true, org_id: true, ticket_id: true, num: true,
    customer_name: true, customer_phone: true, address: true,
    channel: true, payment_method: true, status: true,
    employee_id: true, registered_by: true, fecha: true, order_hour: true,
    paid: true, paid_at: true, paid_by: true, amount_received: true,
    change_amount: true, locked: true, caja_cerrada: true, notes: true,
    created_at: true, updated_at: true,
    employee: { select: { id: true, name: true } },
    registeredBy: { select: { id: true, name: true } },
    paidBy: { select: { id: true, name: true } },
    items: { orderBy: { sort_order: 'asc' as const } },
    ...(includeHistory ? {
      history: {
        orderBy: { created_at: 'asc' as const },
        include: { actor: { select: { id: true, name: true } } },
      },
    } : {}),
  };
}

export default async function orderRoutes(fastify: FastifyInstance) {
  // GET /api/v1/orders?fecha=2026-06-15
  fastify.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const query = z.object({ fecha: z.string().optional() }).parse(req.query);
    const fechaStr = query.fecha ?? new Date().toISOString().split('T')[0];
    const fecha = new Date(fechaStr);

    const orders = await fastify.prisma.order.findMany({
      where: {
        org_id: req.user.orgId,
        OR: [
          { fecha },
          { notes: { contains: `pasado_manana:${fechaStr}` } },
        ],
      },
      select: buildOrderSelect(false),
      orderBy: { order_hour: 'asc' },
    });

    return reply.send({ data: orders });
  });

  // POST /api/v1/orders
  fastify.post('/', { preHandler: [authenticate] }, async (req, reply) => {
    const body = createOrderSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR', details: body.error.flatten() });
    }

    const { items, fecha, ...rest } = body.data;

    // Generar número de pedido: siguiente num del día
    const fechaDate = fecha ? new Date(fecha) : new Date();
    const count = await fastify.prisma.order.count({
      where: { org_id: req.user.orgId, fecha: fechaDate },
    });
    const num = String(count + 1).padStart(3, '0');

    const order = await fastify.prisma.order.create({
      data: {
        ...rest,
        org_id: req.user.orgId,
        num,
        registered_by: req.user.userId,
        fecha: fechaDate,
        items: { create: items },
      },
      select: buildOrderSelect(false),
    });

    // Audit log
    await fastify.prisma.orderHistory.create({
      data: {
        org_id: req.user.orgId,
        order_id: order.id,
        actor_id: req.user.userId,
        action_type: 'create',
        notes: 'Pedido creado',
      },
    });

    fastify.io.to(`org:${req.user.orgId}`).emit('order:created', order as any);

    return reply.status(201).send({ data: order });
  });

  // GET /api/v1/orders/:id
  fastify.get('/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const isAdmin = req.user.role === 'admin';

    const order = await fastify.prisma.order.findFirst({
      where: { id, org_id: req.user.orgId },
      select: buildOrderSelect(isAdmin),
    });

    if (!order) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
    return reply.send({ data: order });
  });

  // PATCH /api/v1/orders/:id
  fastify.patch('/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateOrderSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });
    }

    const existing = await fastify.prisma.order.findFirst({ where: { id, org_id: req.user.orgId } });
    if (!existing) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
    if (existing.locked) return reply.status(409).send({ error: 'Pedido bloqueado', code: 'ORDER_LOCKED' });

    const { items, ...fields } = body.data;
    const historyEntries: any[] = [];

    // Registrar cambios en historial
    const trackFields: Record<string, string> = {
      customer_name: 'Nombre', customer_phone: 'Teléfono',
      address: 'Dirección', payment_method: 'Método de pago',
      employee_id: 'Domiciliario', notes: 'Notas',
    };

    for (const [key, label] of Object.entries(trackFields)) {
      const newVal = (fields as any)[key];
      const oldVal = (existing as any)[key];
      if (newVal !== undefined && String(newVal) !== String(oldVal ?? '')) {
        historyEntries.push({
          org_id: req.user.orgId, order_id: id, actor_id: req.user.userId,
          action_type: 'edit', field: label,
          value_before: String(oldVal ?? ''), value_after: String(newVal ?? ''),
        });
      }
    }

    // Fetch current items before transaction so we can diff removals/additions
    const prevItems = items !== undefined
      ? await fastify.prisma.orderItem.findMany({ where: { order_id: id } })
      : [];

    const updatedOrder = await fastify.prisma.$transaction(async (tx) => {
      if (items !== undefined) {
        const newNames = new Set(items.map(i => i.product_name));
        const prevNames = new Set(prevItems.map(i => i.product_name));

        for (const ri of prevItems.filter(i => !newNames.has(i.product_name))) {
          historyEntries.push({
            org_id: req.user.orgId, order_id: id, actor_id: req.user.userId,
            action_type: 'producto_eliminado', field: 'Producto eliminado',
            value_before: `${ri.quantity_label ? ri.quantity_label + ' ' : ''}${ri.product_name} — $${Number(ri.price).toLocaleString('es-CO')}`,
            value_after: 'Eliminado',
            notes: `Estado al eliminar: ${existing.status}`,
          });
        }
        for (const ai of items.filter(i => !prevNames.has(i.product_name))) {
          historyEntries.push({
            org_id: req.user.orgId, order_id: id, actor_id: req.user.userId,
            action_type: 'producto_agregado', field: 'Producto agregado',
            value_before: '',
            value_after: `${ai.quantity_label ? ai.quantity_label + ' ' : ''}${ai.product_name} — $${ai.price}`,
            notes: `Estado al agregar: ${existing.status}`,
          });
        }

        await tx.orderItem.deleteMany({ where: { order_id: id } });
        await tx.orderItem.createMany({ data: items.map(i => ({ ...i, order_id: id })) });
      }

      const updated = await tx.order.update({
        where: { id },
        data: { ...fields, updated_at: new Date() },
        select: buildOrderSelect(false),
      });

      if (historyEntries.length > 0) {
        await tx.orderHistory.createMany({ data: historyEntries });
      }

      return updated;
    });

    fastify.io.to(`org:${req.user.orgId}`).emit('order:updated', updatedOrder as any);
    return reply.send({ data: updatedOrder });
  });

  // PATCH /api/v1/orders/:id/status
  fastify.patch('/:id/status', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ status: z.enum(['nuevo', 'preparando', 'listo', 'camino', 'entregado', 'papelera']) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Estado inválido', code: 'VALIDATION_ERROR' });

    const existing = await fastify.prisma.order.findFirst({ where: { id, org_id: req.user.orgId } });
    if (!existing) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
    if (existing.locked) return reply.status(409).send({ error: 'Pedido bloqueado', code: 'ORDER_LOCKED' });

    const updated = await fastify.prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id },
        data: { status: body.data.status, updated_at: new Date() },
        select: buildOrderSelect(false),
      });
      await tx.orderHistory.create({
        data: {
          org_id: req.user.orgId, order_id: id, actor_id: req.user.userId,
          action_type: 'estado', field: 'Estado',
          value_before: existing.status, value_after: body.data.status,
        },
      });
      return order;
    });

    fastify.io.to(`org:${req.user.orgId}`).emit('order:moved', { orderId: id, newStatus: body.data.status });
    return reply.send({ data: updated });
  });

  // POST /api/v1/orders/:id/cobro
  fastify.post('/:id/cobro', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      amount_received: z.number().min(0),
      paid_by: z.string().uuid(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    const existing = await fastify.prisma.order.findFirst({
      where: { id, org_id: req.user.orgId },
      include: { items: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
    if (existing.locked) return reply.status(409).send({ error: 'Pedido ya cobrado', code: 'ORDER_LOCKED' });

    const total = existing.items.reduce((s, i) => s + Number(i.price), 0);
    const change = body.data.amount_received - total;

    const updated = await fastify.prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id },
        data: {
          status: 'cerrado', paid: true, locked: true,
          paid_at: new Date(), paid_by: body.data.paid_by,
          amount_received: body.data.amount_received,
          change_amount: change,
          updated_at: new Date(),
        },
        select: buildOrderSelect(false),
      });
      await tx.orderHistory.create({
        data: {
          org_id: req.user.orgId, order_id: id, actor_id: req.user.userId,
          action_type: 'cobro', notes: `Pago confirmado. Recibido: $${body.data.amount_received}. Cambio: $${change}`,
        },
      });
      return order;
    });

    fastify.io.to(`org:${req.user.orgId}`).emit('order:paid', { orderId: id });
    return reply.send({ data: updated });
  });
}
