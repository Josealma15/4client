// WhatsApp/Meta numbers are always stored with the country code (57 + 10-digit
// Colombian mobile, e.g. "573001234567") since that's the format Meta's API sends
// and expects. Staff never dial the +57 themselves and don't need to see it - only
// strip it when the shape actually matches (12 digits starting with 57), so a
// number that's some other format (already local, a different country) is left
// alone instead of getting mangled.
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) return digits.slice(2);
  return phone;
}
