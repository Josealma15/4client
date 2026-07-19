import { z } from 'zod';

// 12+ chars with upper/lower/digit - NIST-aligned minimum, applied to user creation
// and password resets. Login (auth.ts) intentionally does NOT use this: it must keep
// accepting whatever an already-existing user's password is, even a pre-policy one.
export const passwordSchema = z.string()
  .min(12, 'Mínimo 12 caracteres')
  .refine(p => /[A-Z]/.test(p), 'Debe contener al menos una mayúscula')
  .refine(p => /[a-z]/.test(p), 'Debe contener al menos una minúscula')
  .refine(p => /[0-9]/.test(p), 'Debe contener al menos un número');
