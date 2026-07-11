import { PrismaClient } from '@prisma/client';
import { encryptSecret } from './src/lib/crypto.js';

const prisma = new PrismaClient();

async function run() {
  const org = await prisma.organization.findFirst();
  if (!org) return console.log("No org");
  
  try {
    const updated = await prisma.organization.update({
      where: { id: org.id },
      data: {
        wpp_meta_token: encryptSecret("EAALQ..."),
      },
      select: {
        wpp_meta_phone_id: true, wpp_phone: true, welcome_message: true,
      },
    });
    console.log("Success:", updated);
  } catch (e) {
    console.error("Error during update:", e);
  } finally {
    await prisma.$disconnect();
  }
}
run();
