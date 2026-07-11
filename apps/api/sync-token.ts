import { PrismaClient } from '@prisma/client';
import { encryptSecret } from './src/lib/crypto.js';

const p = new PrismaClient();

// Toma el token del .env (que ya debería ser el real)
const TOKEN_FROM_ENV = process.env.META_ACCESS_TOKEN;
const PHONE_ID_FROM_ENV = process.env.META_PHONE_NUMBER_ID;

async function run() {
  if (!TOKEN_FROM_ENV || !PHONE_ID_FROM_ENV) {
    console.error('❌ META_ACCESS_TOKEN o META_PHONE_NUMBER_ID no están definidos en .env');
    process.exit(1);
  }

  console.log('Token del .env (primeros 30 chars):', TOKEN_FROM_ENV.slice(0, 30) + '...');
  console.log('Token length:', TOKEN_FROM_ENV.length);
  console.log('Phone ID:', PHONE_ID_FROM_ENV);

  const encrypted = encryptSecret(TOKEN_FROM_ENV);
  console.log('Cifrado OK. Prefijo enc:v1:', encrypted.startsWith('enc:v1:'));

  const org = await p.organization.findFirst({ select: { id: true } });
  if (!org) { console.error('No org found'); process.exit(1); }

  await p.organization.update({
    where: { id: org.id },
    data: {
      wpp_meta_token: encrypted,
      wpp_meta_phone_id: PHONE_ID_FROM_ENV,
    },
  });

  console.log('✅ Token actualizado correctamente en la BD');
  await p.$disconnect();
}

run().catch(console.error);
