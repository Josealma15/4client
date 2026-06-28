import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL:              z.string().min(1),
  JWT_SECRET:                z.string().min(32),
  JWT_REFRESH_SECRET:        z.string().min(32),
  NODE_ENV:                  z.enum(['development', 'production', 'test']).default('development'),
  PORT:                      z.coerce.number().default(3000),
  FRONTEND_URL:              z.string().default('http://localhost:5173'),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_PHONE_NUMBER_ID:      z.string().optional(),
  META_ACCESS_TOKEN:         z.string().optional(),
  META_APP_SECRET:           z.string().optional(),
  R2_ACCOUNT_ID:             z.string().optional(),
  R2_ACCESS_KEY_ID:          z.string().optional(),
  R2_SECRET_ACCESS_KEY:      z.string().optional(),
  R2_BUCKET_NAME:            z.string().optional(),
  R2_PUBLIC_URL:             z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
