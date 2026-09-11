import {
  IconChevronDown,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Marquee } from './Marquee';
import { Plate } from './Plate';
import type { Player } from './usePlayer';

// how long the scrubber keeps showing where the finger left it while the daemon
// catches up with the seek
const SCRUB_HOLD_MS = 500;

// m:ss, which is the only shape a track length needs
function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// the bar tracks the finger 1:1 and the elapsed label reads from it, so the playhead
// answers on the press rather than on the daemon's next snapshot. a released scrub
// keeps its position until the reported one catches up, which is why the hold exists.
// the knob is only on screen while held: at rest the fill's rounded end is the playhead
function Scrubber({ player }: { player: Player }) {
  const bar = useRef<HTMLDivElement>(null);
  const hold = useRef<number | undefined>(undefined);
  const [scrub, setScrub] = useState<{ pct: number; held: boolean } | null>(null);

  const { positionMs, durationMs, seekTo } = player;
  const held = scrub?.held ?? false;
  const live = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const pct = scrub ? scrub.pct : live;
  const elapsed = durationMs > 0 ? pct * durationMs : positionMs;

  useEffect(() => () => window.clearTimeout(hold.current), []);

  const at = useCallback((clientX: number) => {
    const el = bar.current;
    if (!el) return 0;
    const { left, width } = el.getBoundingClientRect();
    return width > 0 ? Math.min(1, Math.max(0, (clientX - left) / width)) : 0;
  }, []);

  const grab = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (durationMs <= 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    window.clearTimeout(hold.current);
    setScrub({ pct: at(e.clientX), held: true });
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (held) setScrub({ pct: at(e.clientX), held: true });
  };

  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!held) return;
    const p = at(e.clientX);
    seekTo(p * durationMs);
    setScrub({ pct: p, held: false });
    hold.current = window.setTimeout(() => setScrub(null), SCRUB_HOLD_MS);
  };

  return (
    <div>
      <div
        ref={bar}
        onPointerDown={grab}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        className="relative h-7"
        style={{ touchAction: 'none' }}>
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 rounded-full bg-rule-strong transition-[height] duration-200 ease-out"
          style={{ height: held ? 12 : 8 }}
        />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-off-white transition-[height] duration-200 ease-out"
          style={{ width: `${pct * 100}%`, height: held ? 12 : 8 }}
        />
        <div
          className="absolute top-1/2 rounded-full bg-off-white transition-[opacity,transform] duration-200 ease-out"
          style={{
            left: `${pct * 100}%`,
            width: 22,
            height: 22,
            opacity: held ? 1 : 0,
            transform: `translate(-50%, -50%) scale(${held ? 1 : 0.6})`,
          }}
        />
      </div>
      <div className="flex justify-between font-mono text-[13px] tabular-nums text-soft">
        <span>{stamp(elapsed)}</span>
        <span>{durationMs > 0 ? stamp(durationMs) : ''}</span>
      </div>
    </div>
  );
}

// the full-screen now-playing view, one card holding the artwork, the track, and the
// transport. the chevron, back, and mode are the three ways out
export function NowPlaying({ player, onDismiss }: { player: Player; onDismiss: () => void }) {
  const { track, playing, toggle, skip } = player;

  return (
    <div className="absolute inset-0 z-20 select-none bg-black">
      <div className="player-rise relative flex h-full flex-col overflow-hidden rounded-[36px] border border-white/5 bg-neutral-soft px-9 pb-7 pt-6">
        {/* background of dimmed blurred album art */}
        <div className="absolute inset-0 -z-10 overflow-hidden bg-black">
          {track?.artUrl && (
            <>
              <img
                src={track.artUrl}
                alt=""
                className="
                  absolute left-[-30%] top-[-30%]
                  h-[130%] w-[130%]
                  rotate-[25deg] object-cover
                  opacity-50 blur-[100px]
                  saturate-[1.8] contrast-125 brightness-110
                "
              />

              <img
                src={track.artUrl}
                alt=""
                className="
                  absolute right-[-35%] top-[10%]
                  h-[120%] w-[120%]
                  -rotate-[35deg] object-cover
                  opacity-40 blur-[120px]
                  saturate-[2] contrast-125 brightness-110
                "
              />

              <img
                src={track.artUrl}
                alt=""
                className="
                  absolute bottom-[-40%] left-[5%]
                  h-[130%] w-[130%]
                  rotate-[160deg] object-cover
                  opacity-45 blur-[110px]
                  saturate-[1.8] contrast-125 brightness-110
                "
              />
            </>
          )}

          <div className="absolute inset-0 bg-black/20" />

          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/70" />
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="back to apps"
          className="absolute right-6 top-6 z-10 grid h-11 w-11 place-items-center text-soft transition-transform duration-150 ease-out active:scale-[0.92] active:text-near">
          <IconChevronDown size={20} stroke={2.2} />
        </button>

        <div className="flex min-h-0 flex-1 items-center gap-8">
          <div className="player-rise aspect-square h-full shrink-0">
            <Plate cover={track?.artUrl ? { url: track.artUrl } : null} />
          </div>
          <div className="player-rise min-w-0 flex-1" style={{ animationDelay: '80ms' }}>
            <div className="flex min-w-0">
              <Marquee
                text={track?.title ?? 'nothing playing'}
                className="font-display text-[42px] font-semibold tracking-display"
              />
            </div>
            <div className="flex min-w-0">
              <Marquee
                text={track?.album ?? ''}
                className="text-[19px] text-soft"
              />
            </div>
            <div className="flex min-w-0">
              <Marquee
                text={track?.artist ?? ''}
                className="text-[19px] text-soft"
              />
            </div>
          </div>
        </div>

        <div className="player-rise shrink-0 mt-1" style={{ animationDelay: '140ms' }}>
          <Scrubber player={player} />
          <div className="flex items-center justify-center gap-14">
            <button
              type="button"
              onClick={() => skip(-1)}
              aria-label="previous track"
              className="p-2 text-off-white transition-transform duration-150 ease-out active:scale-[0.9]">
              <IconPlayerSkipBackFilled size={40} />
            </button>
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? 'pause' : 'play'}
              className="relative h-12 w-12 text-off-white transition-transform duration-150 ease-out active:scale-[0.9]">
              <span
                className={`absolute inset-0 grid place-items-center transition-[opacity,transform] duration-200 ease-out ${playing ? 'opacity-100' : 'scale-75 opacity-0'}`}>
                <IconPlayerPauseFilled size={48} />
              </span>
              <span
                className={`absolute inset-0 grid place-items-center transition-[opacity,transform] duration-200 ease-out ${playing ? 'scale-75 opacity-0' : 'opacity-100'}`}>
                <IconPlayerPlayFilled size={48} />
              </span>
            </button>
            <button
              type="button"
              onClick={() => skip(1)}
              aria-label="next track"
              className="p-2 text-off-white transition-transform duration-150 ease-out active:scale-[0.9]">
              <IconPlayerSkipForwardFilled size={40} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
