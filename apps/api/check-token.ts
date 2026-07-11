import { PrismaClient } from '@prisma/client';
import { decryptSecret } from './src/lib/crypto.js';

const p = new PrismaClient();

async function run() {
  const org = await p.organization.findFirst({ 
    select: { wpp_meta_token: true, wpp_meta_phone_id: true } 
  });
  
  console.log('phone_id:', org?.wpp_meta_phone_id);
  console.log('token raw (first 80):', org?.wpp_meta_token?.slice(0, 80) + '...');
  console.log('starts with enc:v1:', org?.wpp_meta_token?.startsWith('enc:v1:'));
  
  const decrypted = decryptSecret(org?.wpp_meta_token ?? null);
  console.log('decrypted (first 30):', decrypted?.slice(0, 30) + '...');
  console.log('decrypted length:', decrypted?.length);
  
  await p.$disconnect();
}

run().catch(console.error);
