import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.update({
    where: { slug: 'fruver-san-gabriel' },
    data: {
      wpp_meta_phone_id: '1162357783628740',
      wpp_meta_token: process.env.META_TOKEN!,
    },
  });
  console.log('OK:', org.slug, '| phone_id:', org.wpp_meta_phone_id);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
