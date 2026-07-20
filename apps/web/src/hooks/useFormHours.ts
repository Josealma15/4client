import { useEffect, useState } from 'react';

// Mirrors apps/api/src/routes/public.ts's isWithinFormHours exactly (4am-8pm Colombia,
// UTC-5, no DST) - the backend is what actually enforces this on the client-facing
// form; this is only so staff-side "Formulario"/"Bloquear Link" buttons don't invite
// sending/managing a link the client can't use right now, without needing a page
// reload to notice the window opened or closed.
const FORM_OPEN_HOUR = 4;
const FORM_CLOSED_HOUR = 20;

export function isWithinFormHours(now: number = Date.now()): boolean {
  const hourCol = new Date(now - 5 * 3600000).getUTCHours();
  return hourCol >= FORM_OPEN_HOUR && hourCol < FORM_CLOSED_HOUR;
}

export function useWithinFormHours(): boolean {
  const [within, setWithin] = useState(() => isWithinFormHours());
  useEffect(() => {
    const iv = setInterval(() => setWithin(isWithinFormHours()), 60000);
    return () => clearInterval(iv);
  }, []);
  return within;
}

export const FORM_HOURS_CLOSED_MSG = 'El formulario solo está disponible de 4:00am a 8:00pm.';
