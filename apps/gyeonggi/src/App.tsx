import { BridgethingClient, type ConnectionState } from '@bridgething/client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ConnectionDot } from './ConnectionDot';
import { daemonUrl } from './daemon';
import { Empty } from './Empty';
import { cachedCover, fetchCover } from './icons';
import { CARD_RADIUS, clamp, computeMetrics, flowLayout, gridLayout, interpolateLayout, MIRROR, type Metrics } from './layout';
import { Marquee } from './Marquee';
import { MOCK, mockApps, type AppEntry } from './mock';
import { NowPlaying } from './NowPlaying';
import { Plate } from './Plate';
import { Toast } from './Toast';
import { useClock } from './useClock';
import { useControls } from './useControls';
import { usePlayer } from './usePlayer';
import { useToast } from './useToast';

const RESPONSE = 0.22;
const BOUNCE = 0.72;
const MODE_RESPONSE = 0.32;
const MODE_BOUNCE = 0.85;

// one rotary notch scrubs this far while the now-playing view is open
const SEEK_STEP = 10_000;

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
  const [audio, setAudio] = useState(false);
  const { message: toast, say } = useToast();
  const lastLaunch = useRef(0);
  const clock = useClock(client);
  const player = usePlayer(client);

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
  const audioRef = useRef(audio);
  audioRef.current = audio;

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

  const dismiss = useCallback(() => setAudio(false), []);

  useControls({
    onNext: () => (audio ? player.seekBy(SEEK_STEP) : turn(1)),
    onPrevious: () => (audio ? player.seekBy(-SEEK_STEP) : turn(-1)),
    onSelect: audio ? player.toggle : select,
    onMode: () => {
      if (audio) setAudio(false);
      else if (apps.length > 0) setGrid(g => !g);
    },
    onBack: () => (audio ? setAudio(false) : setGrid(false)),
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
      // grid slots are fixed, so finger tracking has nothing to follow, and the
      // now-playing view owns every gesture while it is up
      if (appsRef.current.length === 0 || gridRef.current || audioRef.current) return;
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

  return (
    <div
      className="relative h-full w-full select-none overflow-hidden bg-bg"
      onPointerDown={onPointerDown}>
      <div className="absolute left-7 right-7 top-5 z-10 flex items-center gap-4">
        <div
          className="flex min-w-0 items-center gap-2 overflow-hidden"
          style={{ animation: 'rise-in 260ms ease-out' }}>
          <span className="font-display text-hero font-medium leading-none tracking-tight-1 text-near tabular-nums mb-0.5">
            {clock}
          </span>
        </div>
        {player.track && (
          <div
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden"
            style={{ animation: 'rise-in 260ms ease-out' }}
            onClick={() => setAudio(true)}>
            {player.track.artUrl ? (
              <img
                src={player.track.artUrl}
                alt=""
                draggable={false}
                className="h-8 w-8 rounded-md border border-white/10 object-cover"
              />
            ) : (
              <div className="h-8 w-8 rounded-md border border-white/10 bg-neutral-soft" />
            )}
            <Marquee text={`${player.track.title}${player.track.artist ? ` - ${player.track.artist}` : ''}`} />
          </div>
        )}
        {!MOCK && <ConnectionDot conn={conn} className="ml-auto" />}
      </div>

      {apps.length === 0 && loaded && (
        <Empty title="no apps installed" detail="install apps from your phone" />
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

      {/* the header and the label are fixed while cards move under both, so each gets
          a fade to the page instead of a hard edge. neither one takes pointers */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[70px] bg-gradient-to-b from-bg from-80% to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-bg/55 from-30% to-transparent" />

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

      {audio && <NowPlaying player={player} onDismiss={dismiss} />}

      <Toast message={toast} />
    </div>
  );
}
