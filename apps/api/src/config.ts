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
  SENTRY_DSN:                z.string().optional(),
  SEED_ADMIN_PASS:           z.string().min(8).default('admin123'),
  SEED_DEV_PASS:             z.string().min(8).default('josejose'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const WEAK_PASSWORDS = ['admin123', 'josejose', 'password', '12345678', 'admin', 'dev123'];
if (parsed.data.NODE_ENV === 'production') {
  if (WEAK_PASSWORDS.includes(parsed.data.SEED_ADMIN_PASS) || WEAK_PASSWORDS.includes(parsed.data.SEED_DEV_PASS)) {
    console.error('❌ SEED_ADMIN_PASS o SEED_DEV_PASS usan contraseñas débiles en producción. Establece variables de entorno seguras.');
    process.exit(1);
  }
}

export const config = parsed.data;
