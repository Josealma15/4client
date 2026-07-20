import { useRegisterSW } from 'virtual:pwa-register/react';

// registerType is 'prompt' (not 'autoUpdate') on purpose - silently force-reloading every
// open tab the moment a deploy goes out is jarring on an operational tool mid-shift. But
// 'prompt' with no actual prompt UI means a new version just sits there forever, waiting
// for someone to fully close and reopen the app - which for most users never happens, so
// they'd be stuck on stale code indefinitely. This is that missing prompt: a small banner
// the user dismisses on their own timing, not a decision made silently in either direction.
export default function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Long-lived tabs (this app is meant to stay open a full shift) otherwise only
      // check for updates on load/navigation - poll periodically so a deploy is
      // discovered without requiring a manual refresh first.
      setInterval(() => registration.update(), 30 * 60 * 1000);
      // Also check right away whenever the tab regains focus - during an active work
      // session someone flips back to an already-open tab far more often than they
      // wait out a 30min timer, and that's the exact moment a just-shipped fix should
      // surface instead of silently sitting cached for up to half an hour more.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      style={{
        position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, background: '#0F4F30', color: '#fff',
        padding: '12px 14px 12px 18px', borderRadius: 14,
        boxShadow: '0 8px 24px rgba(0,0,0,.3)',
        display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 700,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      Hay una nueva versión disponible
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: '#fff', color: '#0F4F30', border: 'none', borderRadius: 9,
          padding: '7px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        Actualizar ahora
      </button>
    </div>
  );
}
