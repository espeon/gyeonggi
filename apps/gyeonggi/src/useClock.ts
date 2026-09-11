import type { BridgethingClient, TimeInfo } from '@bridgething/client';
import { useEffect, useRef, useState } from 'react';

// formatted from the daemon's wall clock rather than the kiosk's, so the display
// matches the phone's timezone and locale
export function useClock(client: BridgethingClient | null): string {
  const [now, setNow] = useState(() => Date.now());
  const zone = useRef<{ tz: string | null; locale: string | null; skewMs: number }>({
    tz: null,
    locale: null,
    skewMs: 0,
  });
  const format = useRef(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }));

  useEffect(() => {
    if (!client) return;
    const apply = (t: TimeInfo) => {
      const z = zone.current;
      z.skewMs = t.wallClockUnixS == null ? 0 : Date.now() - t.wallClockUnixS * 1000;
      if (z.tz !== t.tzIana || z.locale !== t.locale) {
        z.tz = t.tzIana;
        z.locale = t.locale;
        format.current = new Intl.DateTimeFormat(t.locale ?? undefined, {
          timeZone: t.tzIana ?? undefined,
          hour: 'numeric',
          minute: '2-digit',
        });
      }
    };
    const off = client.time.onSnapshot(r => apply(r.time));
    void client.time.get().then(r => {
      if (r.ok) apply(r.response.time);
    });
    const tick = window.setInterval(() => setNow(Date.now() - zone.current.skewMs), 1000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, [client]);

  return format.current.format(now);
}
