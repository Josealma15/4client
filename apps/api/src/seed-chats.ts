import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TODAY = new Date('2026-06-20T00:00:00.000Z');

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000);
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: 'fruver-san-gabriel' } });
  if (!org) throw new Error('Org no encontrada. Ejecuta seed.ts primero.');

  // Remove previous test tickets for today to allow re-running
  const existing = await prisma.ticket.findMany({ where: { org_id: org.id, fecha: TODAY } });
  if (existing.length > 0) {
    await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: existing.map(t => t.id) } } });
    await prisma.ticket.deleteMany({ where: { org_id: org.id, fecha: TODAY } });
    console.log(`🗑  Eliminados ${existing.length} tickets previos de hoy`);
  }

  const chats = [
    {
      phone: '+573001234567',
      customer_name: 'María González',
      unread_count: 2,
      messages: [
        { dir: 'in',  h: 3.0, text: 'Buenas tardes! Quisiera pedir unas verduras' },
        { dir: 'in',  h: 2.9, text: 'Tienen tomate y cebolla?' },
        { dir: 'out', h: 2.8, text: 'Hola María! Sí, tenemos tomate aliño y cebolla roja frescos hoy' },
        { dir: 'in',  h: 2.5, text: 'Qué precio tiene el kilo de tomate?' },
        { dir: 'out', h: 2.4, text: 'Tomate aliño pintón a $3500/kg, cebolla roja $4000/kg' },
        { dir: 'in',  h: 2.0, text: '2 kilos de tomate, 1 kilo de cebolla roja y 500g de cilantro por favor' },
        { dir: 'in',  h: 0.2, text: 'Dirección: Cra 45 #23-12 apto 301, Barrio El Prado' },
      ],
    },
    {
      phone: '+573109876543',
      customer_name: 'Carlos Rodríguez',
      unread_count: 0,
      messages: [
        { dir: 'in',  h: 5.0, text: 'Buenos días! Tienen mandarina?' },
        { dir: 'out', h: 4.9, text: 'Buenos días Carlos! Sí, mandarina bonita a $4000/kg' },
        { dir: 'in',  h: 4.5, text: 'Quiero 3 kilos, también si tienen mora paquete' },
        { dir: 'out', h: 4.4, text: 'Mora paquete x libra a $8000. Dos paquetes?' },
        { dir: 'in',  h: 4.0, text: 'Sí, 3 kg mandarina y 2 libras de mora. Cl 12 #34-56 apto 202' },
        { dir: 'out', h: 3.9, text: 'Perfecto Carlos, le confirmo el pedido ahora' },
      ],
    },
    {
      phone: '+573204567890',
      customer_name: 'Sandra Pérez',
      unread_count: 4,
      messages: [
        { dir: 'in',  h: 1.5, text: 'Hola! Hacen domicilios al barrio Los Álamos?' },
        { dir: 'in',  h: 1.4, text: 'Necesito varias cosas para hacer sancocho' },
        { dir: 'in',  h: 1.3, text: 'Yuca, mazorca, papa capira, zanahoria y cilantro' },
        { dir: 'in',  h: 0.5, text: 'Cuánto costaría todo eso? Somos 6 personas' },
      ],
    },
    {
      phone: '+573156781234',
      customer_name: 'Pedro Martínez',
      unread_count: 2,
      messages: [
        { dir: 'in',  h: 0.5, text: 'Buenas! Me envían el listado de frutas que tienen hoy?' },
        { dir: 'in',  h: 0.2, text: 'También precios si puede ser' },
      ],
    },
  ];

  for (const c of chats) {
    const lastMsg = c.messages[c.messages.length - 1];
    const ticket = await prisma.ticket.create({
      data: {
        org_id: org.id,
        fecha: TODAY,
        phone: c.phone,
        customer_name: c.customer_name,
        last_message_at: hoursAgo(lastMsg.h),
        unread_count: c.unread_count,
        messages: {
          create: c.messages.map(m => ({
            direction: m.dir as 'in' | 'out',
            text: m.text,
            sent_at: hoursAgo(m.h),
          })),
        },
      },
    });
    console.log(`✅ ${c.customer_name} — ${c.messages.length} mensajes (${c.unread_count} sin leer)`);
    console.log(`   ID: ${ticket.id}`);
  }

  console.log('\n🎉 Chats de prueba creados para 2026-06-20');
  console.log('   Ve a "Tickets & Pedidos" para verlos en el swimlane');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
