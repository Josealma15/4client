// Escapes WhatsApp markdown control chars and strips control characters from
// user-supplied text before it's interpolated into an outbound WhatsApp message.
// Deliberately does NOT restrict the character set (product names in the real
// catalog use "/", parentheses, etc. — e.g. "Frijol Verde Vaina / Desgranado") —
// this only prevents a customer from injecting formatting or literal newlines
// into a message built with fixed `*bold*` markers around it.
export function sanitizeForWhatsApp(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\x00-\x1F\x7F]/g, '')   // strip control chars
    .replace(/[*_~`]/g, '\\$&')        // escape WhatsApp markdown chars
    .replace(/\n/g, ' ')               // no embedded newlines
    .trim()
    .slice(0, 200);
}
