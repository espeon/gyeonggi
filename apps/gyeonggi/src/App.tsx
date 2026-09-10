import { BridgethingClient, type ConnectionState, type TimeInfo } from '@bridgething/client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { daemonUrl } from './daemon';
import { cachedCover, fetchCover, type Cover } from './icons';
import { mockApps, type AppEntry } from './mock';
import { useControls } from './useControls';

const MOCK = new URLSearchParams(window.location.search).has('mock');

// composition center sits left of 400: the physical knob makes the whole
// object read right-heavy, so the flow leans away from it
const CX = 400;
const CY = 205;
const PERSPECTIVE = 1100;

// the carousel position is a spring in index units: each detent moves the
// target, the flow chases, and fast spins carry velocity instead of queuing.
// tuned so one detent peaks at ~160ms, settles under 200, and lands with a
// few px of overshoot
const RESPONSE = 0.22;
const BOUNCE = 0.72;

// geometry keyframes by |offset|; right-side x compresses toward the knob so
// clockwise turns read as pulling cards out from behind it
const SIZE = [260, 162, 118, 96];
const SPREAD_L = [0, 214, 322, 396];
const SPREAD_R = [0, 200, 290, 352];
const PUSH = [0, -140, -250, -330];
const YAW = [0, 55, 63, 68];
const DROP = [0, 8, 14, 18];
const FADE = [1, 0.95, 0.55, 0];

function lerpKeys(values: number[], t: number): number {
  const last = values.length - 1;
  const x = Math.min(Math.max(t, 0), last);
  const i = Math.min(Math.floor(x), last - 1);
  return values[i] + (values[i + 1] - values[i]) * (x - i);
}

function applyCard(el: HTMLDivElement, refl: HTMLDivElement | null, offset: number) {
  const depth = Math.abs(offset);
  const dir = Math.sign(offset);
  const spread = dir < 0 ? SPREAD_L : SPREAD_R;
  const size = lerpKeys(SIZE, depth);
  const x = dir * lerpKeys(spread, depth);
  const z = lerpKeys(PUSH, depth);
  const yaw = -dir * lerpKeys(YAW, depth);
  const drop = lerpKeys(DROP, depth);
  const opacity = depth > 2.9 ? 0 : lerpKeys(FADE, depth);
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.left = `${-size / 2}px`;
  el.style.top = `${-size / 2}px`;
  el.style.zIndex = String(30 - Math.round(depth * 8));
  el.style.opacity = opacity.toFixed(3);
  el.style.visibility = opacity <= 0.001 ? 'hidden' : 'visible';
  el.style.transform = `translate3d(${x.toFixed(2)}px, ${drop.toFixed(2)}px, ${z.toFixed(2)}px) rotateY(${yaw.toFixed(2)}deg)`;
  if (refl) {
    const near = Math.max(0, 1 - depth);
    refl.style.opacity = (0.22 * near * near).toFixed(3);
  }
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
          className="absolute inset-0 h-full w-full object-cover"
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

function rubber(over: number): number {
  // progressive resistance past the ends, per fluid-interface rubber-banding
  const dim = 3;
  return (over * dim * 0.55) / (dim + 0.55 * over);
}

// drag mapping: one card per ~200px of finger, matching the average pitch
const PX_PER_INDEX = 205;
const THROW_TIME = 0.3;
const DRAG_THRESHOLD = 10;

export default function App() {
  const client = useMemo(() => (MOCK ? null : new BridgethingClient({ url: daemonUrl() })), []);
  const [conn, setConn] = useState<ConnectionState>(client?.connectionState ?? 'open');
  const [apps, setApps] = useState<AppEntry[]>(() => (MOCK ? mockApps() : []));
  const [loaded, setLoaded] = useState(MOCK);
  const [selected, setSelected] = useState(0);
  const [launching, setLaunching] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lastLaunch = useRef(0);
  const clock = useClock(client);

  // spring state lives outside react; the loop paints transforms directly and
  // a layout effect repaints after every render so react never blanks them
  const pos = useRef(0);
  const vel = useRef(0);
  const kickRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const reflRefs = useRef<Array<HTMLDivElement | null>>([]);
  const appsRef = useRef(apps);
  appsRef.current = apps;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const launchingRef = useRef(launching);
  launchingRef.current = launching;

  const paint = useCallback(() => {
    appsRef.current.forEach((_, i) => {
      const el = cardRefs.current[i];
      if (el) applyCard(el, reflRefs.current[i], i - pos.current);
    });
  }, []);

  useLayoutEffect(paint);

  useEffect(() => {
    const omega = (2 * Math.PI) / RESPONSE;
    const stiffness = omega * omega;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const damping = 2 * (reduced ? 1 : BOUNCE) * omega;

    let raf = 0;
    let last = performance.now();
    // frame-sized steps over-damp a stiff spring badly (zeta*w0*dt ~ 0.7 at
    // 60fps), so integrate in fixed ~4ms substeps
    const H = 1 / 240;
    const step = (now: number) => {
      let dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const target = Math.min(selectedRef.current, Math.max(0, appsRef.current.length - 1));
      while (dt > 0) {
        const h = Math.min(H, dt);
        dt -= h;
        const accel = stiffness * (target - pos.current) - damping * vel.current;
        vel.current += accel * h;
        pos.current += vel.current * h;
      }
      paint();
      if (Math.abs(target - pos.current) < 0.001 && Math.abs(vel.current) < 0.01) {
        pos.current = target;
        vel.current = 0;
        paint();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    kickRef.current = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(step);
    };
    stopRef.current = () => cancelAnimationFrame(raf);
    kickRef.current();
    return () => cancelAnimationFrame(raf);
  }, [paint]);

  useEffect(() => {
    pos.current = Math.min(pos.current, Math.max(0, apps.length - 1));
    kickRef.current();
  }, [selected, apps]);

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

  const turn = useCallback(
    (dir: 1 | -1) => {
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

  // drag to scroll: the flow tracks the finger 1:1, rubber-bands at the ends,
  // and hands the release velocity to the spring, which projects the landing
  const drag = useRef<{
    id: number;
    startX: number;
    startPos: number;
    moved: boolean;
    samples: Array<{ t: number; x: number }>;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (appsRef.current.length === 0) return;
      stopRef.current();
      drag.current = {
        id: e.pointerId,
        startX: e.clientX,
        startPos: pos.current,
        moved: false,
        samples: [{ t: performance.now(), x: e.clientX }],
      };
    },
    [],
  );

  useEffect(() => {
    const blockClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      d.moved = true;
      d.samples.push({ t: performance.now(), x: e.clientX });
      if (d.samples.length > 6) d.samples.shift();
      let p = d.startPos - dx / PX_PER_INDEX;
      const last = appsRef.current.length - 1;
      if (p < 0) p = -rubber(-p);
      if (p > last) p = last + rubber(p - last);
      pos.current = p;
      vel.current = 0;
      paint();
    };
    const end = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      if (!d.moved) return;
      window.addEventListener('click', blockClick, { capture: true, once: true });
      const now = performance.now();
      const recent = d.samples.filter(s => now - s.t < 120);
      let flick = 0;
      if (recent.length >= 2) {
        const a = recent[0];
        const b = recent[recent.length - 1];
        if (b.t > a.t) flick = ((b.x - a.x) / (b.t - a.t)) * 1000;
      }
      const v = Math.max(-8, Math.min(8, -flick / PX_PER_INDEX));
      const n = appsRef.current.length;
      const projected = Math.round(pos.current + v * THROW_TIME);
      vel.current = v;
      setSelected(Math.min(n - 1, Math.max(0, projected)));
      kickRef.current();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [paint]);

  const current = apps[selected] ?? null;
  const connDot =
    conn === 'open' ? 'bg-ok' : conn === 'connecting' ? 'bg-warn' : 'bg-err';

  return (
    <div
      className="relative h-full w-full select-none overflow-hidden bg-bg"
      onPointerDown={onPointerDown}>
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
          {apps.map((app, i) => (
            <div
              key={app.id}
              ref={el => {
                cardRefs.current[i] = el;
              }}
              className="absolute will-change-transform"
              style={{ visibility: 'hidden' }}
              onClick={() => (i === selected ? select() : setSelected(i))}>
              <div
                className="h-full w-full transition-transform duration-500 ease-out"
                style={{ transform: launching === app.id ? 'scale(1.05)' : 'scale(1)' }}>
                <Plate cover={app.cover} />
                <div
                  ref={el => {
                    reflRefs.current[i] = el;
                  }}
                  aria-hidden
                  className="absolute left-0 top-full h-[42%] w-full overflow-hidden"
                  style={{
                    opacity: 0,
                    maskImage: 'linear-gradient(to bottom, black, transparent 85%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 85%)',
                  }}>
                  <div className="h-[238%] w-full" style={{ transform: 'scaleY(-1)', filter: 'blur(1px)' }}>
                    <Plate cover={app.cover} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {current && (
        <div
          key={current.id}
          className="absolute w-[600px] text-center"
          style={{ left: CX - 300, top: 372, animation: 'rise-in 420ms ease-out' }}>
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
