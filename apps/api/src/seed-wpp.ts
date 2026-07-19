import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error('No org found - run seed first');

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      wpp_meta_phone_id:   config.META_PHONE_NUMBER_ID ?? '',
      wpp_meta_token:      config.META_ACCESS_TOKEN ?? '',
      wpp_meta_app_secret: config.META_APP_SECRET ?? '',
      wpp_phone:           '+15556590674',
    },
  });

  console.log(`✅ Org "${org.name}" configurada con credenciales Meta WPP`);
  console.log(`   Phone ID: ${config.META_PHONE_NUMBER_ID}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
