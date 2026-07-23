import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { Prisma, type PrismaClient } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth.js';

// Computes the next sequential order number for org+fecha and creates the order,
// retrying on a unique-constraint collision (@@unique([org_id, num, fecha])).
//
// Uses MAX(num)+1, not COUNT(*)+1 - a deferred order (cierre.ts, decision "manana")
// keeps its ORIGINAL num when its fecha moves to the next day, so that day's number
// space can already have gaps/low numbers "occupied" that have nothing to do with how
// many orders exist there. COUNT(*)+1 doesn't see that and can guess a num that's
// already taken; worse, since count doesn't change between retries with no concurrent
// insert, every retry recomputed the exact same doomed num and collided identically
// until attempts ran out and the raw Prisma error was thrown as a 500. MAX+1 always
// lands past everything actually on that day, deferred-in orders included; the
// attempt-based nudge below is just a safety net for genuine concurrent double-submits.
async function createOrderWithRetryNum<T>(
  prisma: PrismaClient,
  orgId: string,
  fecha: Date,
  createFn: (num: string) => Promise<T>,
): Promise<T> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const existing = await prisma.order.findMany({ where: { org_id: orgId, fecha }, select: { num: true } });
    const maxNum = existing.reduce((max, o) => Math.max(max, parseInt(o.num, 10) || 0), 0);
    const num = String(maxNum + attempt).padStart(3, '0');
    try {
      return await createFn(num);
    } catch (error) {
      const isCollision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isCollision || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  // Unreachable, but keeps TS happy about a guaranteed return/throw.
  throw new Error('No se pudo generar un número de pedido único');
}

const orderItemSchema = z.object({
  product_name:   z.string().min(1).max(200),
  quantity_label: z.string().max(50).optional(),
  price:          z.number().min(0).max(9_999_999),
  sort_order:     z.number().default(0),
  // Round-tripped from GET /orders/:id, not staff-settable in practice (the UI never
  // exposes a way to toggle it) - staff editing/saving an order must not silently
  // clear this provenance flag on items the client themselves added/changed earlier.
  added_by_client: z.boolean().optional().default(false),
});

const createOrderSchema = z.object({
  ticket_id:      z.string().uuid().optional(),
  customer_name:  z.string().min(1).max(200),
  customer_phone: z.string().max(20).optional(),
  // Not required at creation - only enforced at closing time (POST /:id/cobro
  // already checks it), so an order can be opened/dispatched before an address is
  // confirmed and only has to be filled in before it's actually closed.
  address:        z.string().max(500).optional(),
  channel:        z.enum(['whatsapp', 'call']).default('whatsapp'),
  payment_method: z.enum(['sin_asignar', 'cash', 'transfer', 'cod']).default('sin_asignar'),
  employee_id:    z.string().uuid().optional(),
  notes:          z.string().max(1000).optional(),
  fecha:          z.string().optional(),
  items:          z.array(orderItemSchema).min(1).max(100),
});

const updateOrderSchema = z.object({
  customer_name:  z.string().min(1).max(200).optional(),
  // customer_phone deliberately absent - it's always the ticket's real WhatsApp
  // number (set once at creation, see POST / above) and must never drift from it,
  // so there's no field here for staff to send a different value through.
  address:        z.string().max(500).optional(),
  payment_method: z.enum(['sin_asignar', 'cash', 'transfer', 'cod']).optional(),
  employee_id:    z.string().uuid().nullable().optional(),
  notes:          z.string().max(1000).optional(),
  items:          z.array(orderItemSchema).min(1).max(100).optional(),
});

const ORDER_FIELD_LABELS: Record<string, string> = {
  ticket_id: 'ticket', customer_name: 'nombre del cliente', customer_phone: 'teléfono',
  address: 'dirección', channel: 'canal', payment_method: 'método de pago',
  employee_id: 'domiciliario', notes: 'notas', fecha: 'fecha', items: 'productos',
};

// A blanket "Datos inválidos" doesn't tell anyone which field actually failed - turns
// a 2-second fix into a guessing game. Zod already knows exactly which field and why
// (body.error.flatten()); this just turns that into a Spanish sentence naming it,
// e.g. "Falta dirección, nombre del cliente" instead of a dead end.
function orderValidationMessage(error: z.ZodError): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    const label = ORDER_FIELD_LABELS[key] ?? key;
    parts.push(issue.code === 'too_small' || issue.code === 'invalid_type' ? `falta ${label}` : `${label} inválido`);
  }
  if (parts.length === 0) return 'Datos inválidos';
  return 'Revisa: ' + parts.join(', ');
}

// A day with a DailyClose row is a frozen, closed-out snapshot - cierre.ts already
// forced a decision on every order that was open when it ran, so nothing on that day
// should change afterward, no matter which specific decision an order got (even
// "dejar_activo", deliberately left as-is at the time). Mirrors the `existing.locked`
// check already on these routes, just scoped to the whole day instead of one order.
async function findDayClose(prisma: PrismaClient, orgId: string, fecha: Date) {
  return prisma.dailyClose.findUnique({ where: { org_id_fecha: { org_id: orgId, fecha } } });
}

function buildOrderSelect(includeHistory = false) {
  return {
    id: true, org_id: true, ticket_id: true, num: true,
    customer_name: true, customer_phone: true, address: true,
    channel: true, payment_method: true, status: true, source: true,
    employee_id: true, registered_by: true, fecha: true, order_hour: true,
    paid: true, paid_at: true, paid_by: true, amount_received: true,
    change_amount: true, locked: true, caja_cerrada: true, notes: true,
    client_modified: true,
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
  fastify.post('/', { preHandler: [authenticate, requireRole('admin', 'encargado')] }, async (req, reply) => {
    const body = createOrderSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: orderValidationMessage(body.error), code: 'VALIDATION_ERROR', details: body.error.flatten() });
    }

    const { items, fecha, ...rest } = body.data;

    // ticket_id/employee_id are just UUIDs from the request body - Prisma's FK check
    // only confirms the row exists SOMEWHERE, not that it belongs to this org (both
    // are globally-unique ids, not scoped per org). Without this, a crafted id
    // belonging to a different organization would still satisfy the foreign key and
    // silently attach this order to another tenant's ticket/employee.
    if (rest.ticket_id) {
      const ticket = await fastify.prisma.ticket.findFirst({ where: { id: rest.ticket_id, org_id: req.user.orgId }, select: { phone: true } });
      if (!ticket) return reply.status(400).send({ error: 'Ticket no encontrado', code: 'VALIDATION_ERROR' });
      // The customer's phone is always the WhatsApp number the conversation is
      // actually on, never a value typed into a form - whatever customer_phone the
      // request sent gets overridden here rather than trusted.
      rest.customer_phone = ticket.phone;
    }
    if (rest.employee_id) {
      const employee = await fastify.prisma.employee.findFirst({ where: { id: rest.employee_id, org_id: req.user.orgId }, select: { id: true } });
      if (!employee) return reply.status(400).send({ error: 'Domiciliario no encontrado', code: 'VALIDATION_ERROR' });
    }

    // Generar número de pedido: siguiente num del día
    // Parse YYYY-MM-DD as UTC midnight to avoid timezone drift
    const todayUTC = new Date().toISOString().split('T')[0];
    const fechaDate = new Date(fecha ?? todayUTC);

    if (await findDayClose(fastify.prisma, req.user.orgId, fechaDate)) {
      return reply.status(409).send({ error: 'Ese día ya fue cerrado - no se pueden crear pedidos en él', code: 'DAY_CLOSED' });
    }

    const order = await createOrderWithRetryNum(fastify.prisma, req.user.orgId, fechaDate, (num) =>
      fastify.prisma.order.create({
        data: {
          ...rest,
          // Placeholder when left blank - matches the client-form path (public.ts),
          // and is what POST /:id/cobro's "missing fields" check already looks for.
          address: rest.address?.trim() || 'Pendiente de confirmar',
          org_id: req.user.orgId,
          num,
          registered_by: req.user.userId,
          fecha: fechaDate,
          items: { create: items },
        },
        select: buildOrderSelect(false),
      }),
    );

    // Audit log - one 'create' entry for the pedido itself, plus one producto_agregado
    // per starting item (same shape/label a later edit would produce) so "who added
    // what, at what price" is visible from the very first save, not only for changes
    // made afterward.
    await fastify.prisma.orderHistory.create({
      data: {
        org_id: req.user.orgId,
        order_id: order.id,
        actor_id: req.user.userId,
        action_type: 'create',
        notes: 'Pedido creado',
      },
    });
    if (order.items.length > 0) {
      await fastify.prisma.orderHistory.createMany({
        data: order.items.map((i) => ({
          org_id: req.user.orgId, order_id: order.id, actor_id: req.user.userId,
          action_type: 'producto_agregado', field: 'Producto agregado',
          value_before: '',
          value_after: `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name} - $${Number(i.price).toLocaleString('es-CO')}`,
          notes: 'Agregado al crear el pedido',
        })),
      });
    }

    fastify.io.to(`org:${req.user.orgId}`).emit('order:created', order as any);

    return reply.status(201).send({ data: order });
  });

  // GET /api/v1/orders/:id
  fastify.get('/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const isAdmin = req.user.role === 'admin' || req.user.role === 'dev';

    const order = await fastify.prisma.order.findFirst({
      where: { id, org_id: req.user.orgId },
      select: buildOrderSelect(isAdmin),
    });

    if (!order) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
    return reply.send({ data: order });
  });

  // PATCH /api/v1/orders/:id
  fastify.patch('/:id', { preHandler: [authenticate, requireRole('admin', 'encargado')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateOrderSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: orderValidationMessage(body.error), code: 'VALIDATION_ERROR', details: body.error.flatten() });
    }

    const existing = await fastify.prisma.order.findFirst({ where: { id, org_id: req.user.orgId } });
    if (!existing) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
    if (existing.locked) return reply.status(409).send({ error: 'Pedido bloqueado', code: 'ORDER_LOCKED' });
    if (await findDayClose(fastify.prisma, req.user.orgId, existing.fecha)) {
      return reply.status(409).send({ error: 'Ese día ya fue cerrado - el pedido quedó congelado', code: 'DAY_CLOSED' });
    }

    const { items, ...fields } = body.data;

    // Same cross-org guard as POST / - employee_id is a bare UUID from the request
    // body, and Employee.id is globally unique (not scoped per org), so an id
    // belonging to a different organization would otherwise still pass the FK check.
    if (fields.employee_id) {
      const employee = await fastify.prisma.employee.findFirst({ where: { id: fields.employee_id, org_id: req.user.orgId }, select: { id: true } });
      if (!employee) return reply.status(400).send({ error: 'Domiciliario no encontrado', code: 'VALIDATION_ERROR' });
    }

    const historyEntries: any[] = [];

    const PAYMENT_LABELS: Record<string, string> = {
      cod: 'Cobro en casa', cash: 'Efectivo', transfer: 'Transferencia', sin_asignar: 'Sin asignar',
    };

    // Registrar cambios en historial
    const trackFields: Record<string, string> = {
      customer_name: 'Nombre',
      address: 'Dirección', payment_method: 'Método de pago',
      employee_id: 'Domiciliario', notes: 'Notas',
    };

    // Prefetch employee names for readable history
    const empIdsBefore = existing.employee_id ? [existing.employee_id] : [];
    const empIdAfter = (fields as any).employee_id;
    const empIdsAfter = empIdAfter ? [empIdAfter] : [];
    const allEmpIds = [...new Set([...empIdsBefore, ...empIdsAfter])];
    const empMap = new Map<string, string>();
    if (allEmpIds.length > 0) {
      const emps = await fastify.prisma.employee.findMany({
        where: { id: { in: allEmpIds } },
        select: { id: true, name: true },
      });
      for (const e of emps) empMap.set(e.id, e.name);
    }

    function displayVal(key: string, val: any): string {
      if (val == null) return key === 'employee_id' ? 'Sin asignar' : '';
      if (key === 'payment_method') return PAYMENT_LABELS[String(val)] ?? String(val);
      if (key === 'employee_id') return empMap.get(String(val)) ?? String(val);
      return String(val);
    }

    for (const [key, label] of Object.entries(trackFields)) {
      const newVal = (fields as any)[key];
      const oldVal = (existing as any)[key];
      if (newVal !== undefined && String(newVal ?? '') !== String(oldVal ?? '')) {
        historyEntries.push({
          org_id: req.user.orgId, order_id: id, actor_id: req.user.userId,
          action_type: 'edit', field: label,
          value_before: displayVal(key, oldVal),
          value_after: displayVal(key, newVal),
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
            value_before: `${ri.quantity_label ? ri.quantity_label + ' ' : ''}${ri.product_name} - $${Number(ri.price).toLocaleString('es-CO')}`,
            value_after: 'Eliminado',
            notes: `Estado al eliminar: ${existing.status}`,
          });
        }
        for (const ai of items.filter(i => !prevNames.has(i.product_name))) {
          historyEntries.push({
            org_id: req.user.orgId, order_id: id, actor_id: req.user.userId,
            action_type: 'producto_agregado', field: 'Producto agregado',
            value_before: '',
            value_after: `${ai.quantity_label ? ai.quantity_label + ' ' : ''}${ai.product_name} - $${ai.price}`,
            notes: `Estado al agregar: ${existing.status}`,
          });
        }

        // Same product name kept, but its price or quantity changed - the add/remove
        // diff above misses this entirely (it only sees names, not values), so before
        // this a price correction on an existing line left no trace in the history.
        const prevByName = new Map(prevItems.map(i => [i.product_name, i]));
        for (const ai of items.filter(i => prevNames.has(i.product_name))) {
          const prior = prevByName.get(ai.product_name)!;
          const qtyChanged = (prior.quantity_label ?? '') !== (ai.quantity_label ?? '');
          const priceChanged = Number(prior.price) !== Number(ai.price);
          if (!qtyChanged && !priceChanged) continue;
          historyEntries.push({
            org_id: req.user.orgId, order_id: id, actor_id: req.user.userId,
            action_type: 'producto_modificado', field: 'Producto modificado',
            value_before: `${prior.quantity_label ? prior.quantity_label + ' ' : ''}${prior.product_name} - $${Number(prior.price).toLocaleString('es-CO')}`,
            value_after: `${ai.quantity_label ? ai.quantity_label + ' ' : ''}${ai.product_name} - $${Number(ai.price).toLocaleString('es-CO')}`,
            notes: `Estado al modificar: ${existing.status}`,
          });
        }

        await tx.orderItem.deleteMany({ where: { order_id: id } });
        await tx.orderItem.createMany({ data: items.map(i => ({ ...i, order_id: id })) });
      }

      const updated = await tx.order.update({
        where: { id },
        // client_modified is never cleared by a staff save (per updated user
        // direction - it must stay visible permanently, same as each item's own
        // added_by_client flag, not just until someone opens and saves the order).
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
  fastify.patch('/:id/status', { preHandler: [authenticate, requireRole('admin', 'encargado')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ status: z.enum(['nuevo', 'preparando', 'listo', 'camino', 'entregado', 'papelera']) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Estado inválido', code: 'VALIDATION_ERROR' });

    const existing = await fastify.prisma.order.findFirst({ where: { id, org_id: req.user.orgId } });
    if (!existing) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
    if (existing.locked) return reply.status(409).send({ error: 'Pedido bloqueado', code: 'ORDER_LOCKED' });
    if (await findDayClose(fastify.prisma, req.user.orgId, existing.fecha)) {
      return reply.status(409).send({ error: 'Ese día ya fue cerrado - el pedido quedó congelado', code: 'DAY_CLOSED' });
    }

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
  fastify.post('/:id/cobro', { preHandler: [authenticate, requireRole('admin', 'encargado')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      amount_received: z.number().min(0).max(99_999_999),
      password: z.string().min(1),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    // Verify current user's password before allowing cobro
    const currentUser = await fastify.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { password_hash: true },
    });
    if (!currentUser) return reply.status(404).send({ error: 'Usuario no encontrado', code: 'NOT_FOUND' });
    const passwordValid = await bcrypt.compare(body.data.password, currentUser.password_hash);
    if (!passwordValid) return reply.status(403).send({ error: 'Contraseña incorrecta', code: 'INVALID_PASSWORD' });

    const existing = await fastify.prisma.order.findFirst({
      where: { id, org_id: req.user.orgId },
      include: { items: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
    if (existing.locked) return reply.status(409).send({ error: 'Pedido ya cobrado', code: 'ORDER_LOCKED' });
    if (await findDayClose(fastify.prisma, req.user.orgId, existing.fecha)) {
      return reply.status(409).send({ error: 'Ese día ya fue cerrado - el pedido quedó congelado', code: 'DAY_CLOSED' });
    }

    // A pedido must be fully filled in before it can be closed - required so orders
    // created from the client form (which starts with a placeholder address, no
    // payment method, no domiciliario assigned) can't be cobrado half-empty.
    const missing: string[] = [];
    if (!existing.customer_name?.trim()) missing.push('nombre');
    if (!existing.customer_phone?.trim()) missing.push('teléfono');
    if (!existing.address?.trim() || existing.address.trim().toLowerCase() === 'pendiente de confirmar') missing.push('dirección');
    if (!existing.payment_method || existing.payment_method === 'sin_asignar') missing.push('método de pago');
    if (!existing.employee_id) missing.push('domiciliario');
    if (existing.items.length === 0) missing.push('productos');
    // Every item needs a real price - a single unpriced product (even just one, even
    // if the rest of the order totals something > 0) must block closing, not just an
    // all-zero order.
    const unpriced = existing.items.filter(i => Number(i.price) <= 0);
    if (unpriced.length > 0) missing.push(`precio de ${unpriced.map(i => i.product_name).join(', ')}`);
    if (missing.length > 0) {
      return reply.status(400).send({ error: `Faltan datos para cerrar el pedido: ${missing.join(', ')}`, code: 'MISSING_FIELDS' });
    }

    const total = existing.items.reduce((s, i) => s + Number(i.price), 0);
    if (total <= 0) {
      return reply.status(400).send({ error: 'No es posible cerrar el pedido porque no tiene un total calculado', code: 'NO_TOTAL' });
    }
    const change = body.data.amount_received - total;

    const updated = await fastify.prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id },
        data: {
          status: 'cerrado', paid: true, locked: true,
          paid_at: new Date(),
          paid_by: req.user.userId,   // always from authenticated user, never from body
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
