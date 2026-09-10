import { BridgethingClient, type ConnectionState, type TimeInfo } from '@bridgething/client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { daemonUrl } from './daemon';
import { cachedCover, fetchCover, type Cover } from './icons';
import { mockApps, type AppEntry } from './mock';
import { useControls } from './useControls';

const MOCK = new URLSearchParams(window.location.search).has('mock');

// composition center sits left of 400: the physical knob makes the whole
// object read right-heavy, so the flow leans away from it
const CX = 355;
const CY = 205;
const PERSPECTIVE = 1100;
const SIZES = [260, 162, 118];
const PUSH = [0, -140, -250];
const YAW = [0, 55, 63];
const DROP = [0, 8, 14];
// x-distance from CX by depth; side 0 is left (wider), side 1 right, which
// compresses toward the knob so clockwise turns pull cards out from behind it
const SPREAD = [
  [0, 0],
  [214, 200],
  [322, 290],
];

function cardStyle(offset: number, fast: boolean, launching: boolean): CSSProperties {
  const depth = Math.abs(offset);
  const hidden = depth > 2;
  const a = Math.min(depth, 2);
  const size = SIZES[a];
  const side = offset < 0 ? 0 : 1;
  const x = offset === 0 ? 0 : Math.sign(offset) * SPREAD[a][side];
  const yaw = offset === 0 ? 0 : -Math.sign(offset) * YAW[a];
  return {
    width: size,
    height: size,
    left: -size / 2,
    top: -size / 2,
    zIndex: 10 - a,
    opacity: hidden ? 0 : depth === 0 ? 1 : depth === 1 ? 0.95 : 0.55,
    visibility: hidden ? 'hidden' : 'visible',
    transform: `translate3d(${x}px, ${DROP[a]}px, ${PUSH[a]}px) rotateY(${yaw}deg) scale(${launching ? 1.06 : 1})`,
    // the snap overshoots a few px; fast spins drop the spring so the flow keeps up
    transition: `transform ${fast ? 90 : 180}ms cubic-bezier(0.22, 1, 0.3, ${fast ? 1 : 1.18}), opacity 160ms linear`,
  };
}

function Plate({ cover }: { cover: Cover | null }) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-[18px] border border-white/10"
      style={{ background: cover?.plate ?? '#171c21' }}>
      {cover ? (
        <img
          src={cover.url}
          alt=""
          draggable={false}
          className="absolute inset-[10%] h-[80%] w-[80%] object-contain"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center font-mono text-4xl text-white/25">?</div>
      )}
    </div>
  );
}

function useClock(client: BridgethingClient | null): string {
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

export default function App() {
  const client = useMemo(() => (MOCK ? null : new BridgethingClient({ url: daemonUrl() })), []);
  const [conn, setConn] = useState<ConnectionState>(client?.connectionState ?? 'open');
  const [apps, setApps] = useState<AppEntry[]>(() => (MOCK ? mockApps() : []));
  const [loaded, setLoaded] = useState(MOCK);
  const [selected, setSelected] = useState(0);
  const [fast, setFast] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lastTurn = useRef(0);
  const lastLaunch = useRef(0);
  const clock = useClock(client);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(cur => (cur === msg ? null : cur)), 1600);
  }, []);

  const load = useCallback(async () => {
    if (!client) return;
    const res = await client.webapp.list();
    setLoaded(true);
    if (!res.ok) return;
    const infos = [...res.response.webapps].sort((a, b) => a.name.localeCompare(b.name));
    setApps(infos.map(i => ({ id: i.id, name: i.name, description: i.description, cover: cachedCover(i.id) ?? null })));
    for (const info of infos) {
      const cover = await fetchCover(client, info.id);
      if (cover)
        setApps(prev => prev.map(a => (a.id === info.id ? { ...a, cover } : a)));
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const offConn = client.on(e => {
      if (e.type === 'open' || e.type === 'close' || e.type === 'connecting') setConn(client.connectionState);
      if (e.type === 'open') void load();
    });
    const offInstalled = client.webapp.onWebappInstalled(() => void load());
    const offUninstalled = client.webapp.onWebappUninstalled(() => void load());
    void load();
    return () => {
      offConn();
      offInstalled();
      offUninstalled();
    };
  }, [client, load]);

  useEffect(() => {
    setSelected(s => Math.min(s, Math.max(0, apps.length - 1)));
  }, [apps.length]);

  const turn = useCallback(
    (dir: 1 | -1) => {
      const now = performance.now();
      setFast(now - lastTurn.current < 160);
      lastTurn.current = now;
      setSelected(s => Math.min(apps.length - 1, Math.max(0, s + dir)));
    },
    [apps.length],
  );

  const select = useCallback(() => {
    const app = apps[selected];
    if (!app) return;
    const now = performance.now();
    if (now - lastLaunch.current < 400) return;
    lastLaunch.current = now;
    setLaunching(app.id);
    window.setTimeout(() => setLaunching(cur => (cur === app.id ? null : cur)), 700);
    if (!client) return say(`would open ${app.name}`);
    void client.webapp.activate({ id: app.id }).then(res => {
      if (!res.ok) say(`couldn't open ${app.name}`);
    });
  }, [apps, selected, client, say]);

  useControls({ onNext: () => turn(1), onPrevious: () => turn(-1), onSelect: select });

  const current = apps[selected] ?? null;
  const connDot =
    conn === 'open' ? 'bg-ok' : conn === 'connecting' ? 'bg-warn' : 'bg-err';

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-bg">
      <div className="absolute left-7 top-5 font-display text-[26px] font-medium leading-none tracking-tight-1 text-near tabular-nums">
        {clock}
      </div>
      {!MOCK && (
        <div className="absolute right-7 top-7 flex items-center gap-2">
          {conn !== 'open' && <span className="font-mono text-hint text-dim">{conn}</span>}
          <span className={`h-2 w-2 rounded-full ${connDot}`} />
        </div>
      )}

      {apps.length === 0 && loaded && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-display text-title text-soft">no apps installed</div>
            <div className="mt-2 text-body text-dim">install apps from your phone</div>
          </div>
        </div>
      )}
      {apps.length === 0 && !loaded && conn !== 'open' && (
        <div className="absolute inset-0 grid place-items-center text-body text-dim">
          waiting for the daemon
        </div>
      )}

      <div className="absolute inset-0" style={{ perspective: `${PERSPECTIVE}px` }}>
        <div className="absolute" style={{ left: CX, top: CY, transformStyle: 'preserve-3d' }}>
          {apps.map((app, i) => {
            const offset = i - selected;
            return (
              <div
                key={app.id}
                className="absolute"
                style={cardStyle(offset, fast, launching === app.id)}
                onClick={() => (offset === 0 ? select() : setSelected(i))}>
                <Plate cover={app.cover} />
                {offset === 0 && app.cover && (
                  <div
                    aria-hidden
                    className="absolute left-0 top-full h-[42%] w-full overflow-hidden"
                    style={{
                      opacity: 0.22,
                      maskImage: 'linear-gradient(to bottom, black, transparent 85%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 85%)',
                    }}>
                    <div className="h-[238%] w-full" style={{ transform: 'scaleY(-1)', filter: 'blur(1px)' }}>
                      <Plate cover={app.cover} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {current && (
        <div
          key={current.id}
          className="absolute w-[600px] text-center"
          style={{ left: CX - 300, top: 372, animation: 'rise-in 180ms ease-out' }}>
          <div className="truncate font-display text-[30px] font-medium leading-tight tracking-display">
            {current.name}
          </div>
          {current.description && (
            <div className="mt-1 truncate text-[15px] text-soft">{current.description}</div>
          )}
        </div>
      )}

      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-edge bg-screen px-4 py-2 font-mono text-hint text-near">
          {toast}
        </div>
      )}
    </div>
  );
}
