export default function DevLinksPanel() {
  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)', padding: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gt)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Links rápidos</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { label: 'Railway (backend + BD)', url: 'https://railway.app' },
            { label: 'Vercel (frontend)', url: 'https://vercel.com' },
            { label: 'Sentry (errores)', url: 'https://sentry.io' },
            { label: 'Meta Business (WPP)', url: 'https://business.facebook.com' },
            { label: 'Cloudflare (DNS)', url: 'https://cloudflare.com' },
            { label: 'Prisma Studio (local)', url: 'http://localhost:5555' },
          ].map(({ label, url }) => (
            <a key={label} href={url} target="_blank" rel="noreferrer"
              style={{ fontSize: 13, color: 'var(--v)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--gt)' }}>→</span> {label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
