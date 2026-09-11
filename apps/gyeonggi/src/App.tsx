import { BridgethingClient, type ConnectionState, type MediaItem, type TimeInfo } from '@bridgething/client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { daemonUrl } from './daemon';
import { cachedCover, fetchCover, type Cover } from './icons';
import { CARD_RADIUS, clamp, computeMetrics, flowLayout, gridLayout, interpolateLayout, MIRROR, type Metrics } from './layout';
import { fixtureCover, mockApps, type AppEntry } from './mock';
import { useControls } from './useControls';

const MOCK = new URLSearchParams(window.location.search).has('mock');

const RESPONSE = 0.22;
const BOUNCE = 0.72;
const MODE_RESPONSE = 0.32;
const MODE_BOUNCE = 0.85;

// the kiosk is permanently 800x480, so the scene is measured once at boot
const METRICS = computeMetrics(window.innerWidth, window.innerHeight);

function applyCard(
  el: HTMLDivElement,
  refl: HTMLDivElement | null,
  i: number,
  offset: number,
  mode: number,
  selected: boolean,
  scroll: number,
  m: Metrics,
) {
  const t = clamp(mode, 0, 1);
  const layout = interpolateLayout(flowLayout(offset, m), gridLayout(i, scroll, selected, m), mode);
  el.style.width = `${layout.size}px`;
  el.style.height = `${layout.size}px`;
  el.style.left = `${-layout.size / 2}px`;
  el.style.top = `${-layout.size / 2}px`;
  el.style.borderRadius = `${CARD_RADIUS}px`;
  el.style.zIndex = String(layout.zIndex);
  el.style.opacity = layout.opacity.toFixed(3);
  el.style.visibility = layout.opacity <= 0.001 ? 'hidden' : 'visible';
  el.style.transform = `translate3d(${layout.x.toFixed(2)}px, ${layout.y.toFixed(2)}px, ${layout.z.toFixed(2)}px) rotateY(${layout.yaw.toFixed(2)}deg)`;
  const ring = t * (selected ? 0.4 : 0);
  el.style.boxShadow = ring > 0.01 ? `0 0 0 2px rgba(255,255,255,${ring.toFixed(2)})` : 'none';
  if (refl) {
    const near = Math.max(0, 1 - Math.abs(offset));
    refl.style.opacity = (0.22 * near * near * (1 - t)).toFixed(3);
  }
}

type NowPlaying = {
  title: string;
  artist: string | null;
  artUrl: string | null;
};

function useNowPlaying(client: BridgethingClient | null): NowPlaying | null {
  const [track, setTrack] = useState<{ title: string; artist: string | null; artId: string | null } | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);

  useEffect(() => {
    // the fixture track keeps the design loop honest in ?mock
    if (MOCK) {
      setTrack({ title: 'Midnight City (Extended Mix)', artist: 'M83', artId: null });
      setArtUrl(fixtureCover('M', 0).url);
      return;
    }
    if (!client) return;
    const take = (t: MediaItem | null) =>
      t?.title ? { title: t.title, artist: t.artist, artId: t.artworkId } : null;
    const off = client.player.onSnapshot(r => setTrack(take(r.state.track)));
    void client.player.stateGet().then(res => {
      if (res.ok) setTrack(take(res.response.state.track));
    });
    return off;
  }, [client]);

  useEffect(() => {
    if (MOCK) return;
    if (!client || !track?.artId) {
      setArtUrl(null);
      return;
    }
    let dead = false;
    let url: string | null = null;
    void client.asset
      .get({ id: track.artId, requestId: crypto.randomUUID() })
      .then(res => {
        if (dead || !res.ok) return;
        const bytes = Uint8Array.from(res.response.bytes as unknown as number[]);
        url = URL.createObjectURL(new Blob([bytes], { type: res.response.mime ?? 'image/jpeg' }));
        setArtUrl(url);
      });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, track?.artId]);

  return track ? { title: track.title, artist: track.artist, artUrl } : null;
}

function Plate({ cover }: { cover: Cover | null }) {
  return (
    <div
      className="relative h-full w-full overflow-hidden border border-white/10"
      style={{ background: cover?.plate ?? '#171c21', borderRadius: CARD_RADIUS }}>
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

// the now-playing line runs as a ticker once it outgrows the bar: hold, scroll one
// pass, and wrap onto a second copy of itself so the join is seamless. the hold is a
// keyframe segment rather than a delay, so it repeats every pass instead of once.
// distances are px rather than -50% so the keyframes do not depend on the second copy
const MARQUEE_GAP = 48;
const MARQUEE_SPEED = 40;
const MARQUEE_HOLD = 1;

function Marquee({ text }: { text: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const [scrolling, setScrolling] = useState(false);

  useLayoutEffect(() => {
    const vp = viewport.current;
    const el = track.current;
    const one = copy.current;
    if (!vp || !el || !one) return;
    let pass: Animation | null = null;
    // the copy can change width without the text changing, when the webfont swaps in
    const apply = () => {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const width = one.offsetWidth;
      const over = !still && width > vp.clientWidth;
      setScrolling(over);
      pass?.cancel();
      pass = null;
      if (!over) return;
      const scroll = (width + MARQUEE_GAP) / MARQUEE_SPEED;
      pass = el.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: MARQUEE_HOLD / (MARQUEE_HOLD + scroll) },
          { transform: `translateX(-${width + MARQUEE_GAP}px)`, offset: 1 },
        ],
        { duration: (MARQUEE_HOLD + scroll) * 1000, iterations: Infinity },
      );
    };
    apply();
    const seen = new ResizeObserver(apply);
    seen.observe(one);
    seen.observe(vp);
    return () => {
      seen.disconnect();
      pass?.cancel();
    };
  }, [text]);

  return (
    <span ref={viewport} className="min-w-0 flex-1 overflow-hidden">
      <span ref={track} key={text} className="inline-flex whitespace-nowrap">
        <span ref={copy} className="shrink-0" style={{ marginRight: MARQUEE_GAP }}>
          {text}
        </span>
        {scrolling && (
          <span aria-hidden className="shrink-0" style={{ marginRight: MARQUEE_GAP }}>
            {text}
          </span>
        )}
      </span>
    </span>
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
  const [grid, setGrid] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lastLaunch = useRef(0);
  const clock = useClock(client);
  const nowPlaying = useNowPlaying(client);

  // spring state lives outside react; the loop paints transforms directly and
  // a layout effect repaints after every render so react never blanks them
  const pos = useRef(0);
  const vel = useRef(0);
  const mode = useRef({ p: 0, v: 0 });
  const scroll = useRef(0);
  const gridRef = useRef(grid);
  gridRef.current = grid;
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
    const m = mode.current.p;
    appsRef.current.forEach((_, i) => {
      const el = cardRefs.current[i];
      if (el) applyCard(el, reflRefs.current[i], i, i - pos.current, m, i === selectedRef.current, scroll.current, METRICS);
    });
  }, []);

  useLayoutEffect(paint);

  useEffect(() => {
    const omega = (2 * Math.PI) / RESPONSE;
    const stiffness = omega * omega;
    const modeOmega = (2 * Math.PI) / MODE_RESPONSE;
    const modeStiffness = modeOmega * modeOmega;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const damping = 2 * (reduced ? 1 : BOUNCE) * omega;
    const modeDamping = 2 * (reduced ? 1 : MODE_BOUNCE) * modeOmega;

    let raf = 0;
    let last = performance.now();
    // frame-sized steps over-damp a stiff spring badly (zeta*w0*dt ~ 0.7 at
    // 60fps), so integrate in fixed ~4ms substeps
    const H = 1 / 240;
    const step = (now: number) => {
      let dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const n = appsRef.current.length;
      const posTarget = Math.min(selectedRef.current, Math.max(0, n - 1));
      const modeTarget = gridRef.current ? 1 : 0;
      const rows = Math.ceil(n / METRICS.cols);
      const maxScroll = Math.max(0, rows - METRICS.rows) * METRICS.gridPitch;
      const selRow = Math.floor(posTarget / METRICS.cols);
      const scrollTarget = Math.min(maxScroll, Math.max(0, (selRow - 1) * METRICS.gridPitch));
      while (dt > 0) {
        const h = Math.min(H, dt);
        dt -= h;
        const accel = stiffness * (posTarget - pos.current) - damping * vel.current;
        vel.current += accel * h;
        pos.current += vel.current * h;
        const mAccel = modeStiffness * (modeTarget - mode.current.p) - modeDamping * mode.current.v;
        mode.current.v += mAccel * h;
        mode.current.p += mode.current.v * h;
        scroll.current += (scrollTarget - scroll.current) * Math.min(1, 10 * h);
      }
      paint();
      const settled =
        Math.abs(posTarget - pos.current) < 0.001 &&
        Math.abs(vel.current) < 0.01 &&
        Math.abs(modeTarget - mode.current.p) < 0.001 &&
        Math.abs(mode.current.v) < 0.01;
      if (settled) {
        pos.current = posTarget;
        vel.current = 0;
        mode.current.p = modeTarget;
        mode.current.v = 0;
        scroll.current = scrollTarget;
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
  }, [selected, apps, grid]);

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

  useControls({
    onNext: () => turn(1),
    onPrevious: () => turn(-1),
    onSelect: select,
    onMode: () => {
      if (apps.length > 0) setGrid(g => !g);
    },
    onBack: () => setGrid(false),
  });

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
      // grid slots are fixed, so finger tracking has nothing to follow
      if (appsRef.current.length === 0 || gridRef.current) return;
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
      <div className="absolute left-7 right-7 top-5 flex items-center gap-4">
        <span className="font-display text-[26px] font-medium leading-none tracking-tight-1 text-near tabular-nums">
          {clock}
        </span>
        {nowPlaying && (
          <div
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
            style={{ animation: 'rise-in 260ms ease-out' }}>
            {nowPlaying.artUrl ? (
              <img
                src={nowPlaying.artUrl}
                alt=""
                draggable={false}
                className="h-8 w-8 rounded-md border border-white/10 object-cover"
              />
            ) : (
              <div className="h-8 w-8 rounded-md border border-white/10 bg-neutral-soft" />
            )}
            <Marquee text={`${nowPlaying.title}${nowPlaying.artist ? ` - ${nowPlaying.artist}` : ''}`} />
          </div>
        )}
        {!MOCK && (
          <div className="ml-auto flex items-center gap-2">
            {conn !== 'open' && <span className="font-mono text-hint text-dim">{conn}</span>}
            <span className={`h-2 w-2 rounded-full ${connDot}`} />
          </div>
        )}
      </div>

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

      <div className="absolute inset-0" style={{ perspective: `${METRICS.perspective}px` }}>
        <div className="absolute" style={{ left: METRICS.cx, top: METRICS.cy, transformStyle: 'preserve-3d' }}>
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
                  className="absolute left-0 top-full w-full overflow-hidden"
                  style={{
                    opacity: 0,
                    height: MIRROR.slice,
                    maskImage: 'linear-gradient(to bottom, black, transparent 85%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 85%)',
                  }}>
                  <div className="w-full" style={{ height: MIRROR.plate, transform: 'scaleY(-1)', filter: 'blur(1px)' }}>
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
          className="absolute text-center"
          style={{ left: METRICS.cx - METRICS.labelWidth / 2, width: METRICS.labelWidth, top: grid ? METRICS.labelYGrid : METRICS.labelYFlow, transition: 'top 260ms ease', animation: 'rise-in 420ms ease-out' }}>
          <div className="truncate font-display text-[30px] font-medium leading-tight tracking-display">
            {current.name}
          </div>
          {current.description && !grid && (
            <div className="mt-1 truncate text-[15px] text-soft">{current.description}</div>
          )}
        </div>
      )}

      {toast && (
        <div
          className="absolute bottom-4 -translate-x-1/2 rounded-md border border-edge bg-screen px-4 py-2 font-mono text-hint text-near"
          style={{ left: METRICS.cx }}>
          {toast}
        </div>
      )}
    </div>
  );
}
