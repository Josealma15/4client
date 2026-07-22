// Picks the API base URL at RUNTIME (by hostname) instead of a build-time env var
// scoped per Cloudflare Pages environment - that split (Production vs Preview) turned
// out to be awkward to find/set correctly in Cloudflare's newer unified Workers/Pages
// UI. Runtime detection is also more robust: it works for whatever preview URL
// Cloudflare happens to generate, with no per-environment variable to keep in sync.
//
// VITE_API_URL, if set, still wins - Vite bakes it in at BUILD time (import.meta.env
// is a static replacement, not read live), so it must be left UNSET in Cloudflare
// Pages for this to actually kick in on every deployment. It's still useful for local
// dev (`apps/web/.env.local`, gitignored) to point at a local API instead of Railway.
const PROD_API = 'https://api.4client.shop';
const DEV_API = 'https://4client-dev.up.railway.app';

export function resolveApiBase(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window === 'undefined') return PROD_API;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
  // Cloudflare Pages' stable branch-preview alias for `dev` is `dev.<project>.pages.dev` -
  // any other *.pages.dev host (the production alias, or a one-off preview hash from a
  // non-dev branch) falls through to production, same as the real custom domain.
  if (host.startsWith('dev.') && host.endsWith('.pages.dev')) return DEV_API;
  return PROD_API;
}
