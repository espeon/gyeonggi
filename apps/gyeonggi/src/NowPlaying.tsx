import { Plate } from './Plate';
import type { Player } from './usePlayer';

const ART = 180;

// m:ss, which is the only shape a track length needs
function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// the full-screen now-playing view, covering the flow and the clock behind it.
// tapping the artwork is one of the three ways back, alongside back and mode
export function NowPlaying({ player, onDismiss }: { player: Player; onDismiss: () => void }) {
  const { track, playing, positionMs, durationMs, toggle, skip } = player;
  const progress = durationMs > 0 ? Math.min(100, (100 * positionMs) / durationMs) : 0;

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-bg">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="back to apps"
        className="overflow-hidden"
        style={{ width: ART, height: ART }}>
        <Plate cover={track?.artUrl ? { url: track.artUrl } : null} />
      </button>

      <div className="mt-4 w-[560px] truncate text-center font-display text-[30px] font-medium leading-tight tracking-display">
        {track?.title ?? 'nothing playing'}
      </div>
      <div className="mt-1 w-[560px] truncate text-center text-[15px] text-soft">{track?.artist ?? ''}</div>

      <div className="mt-5 flex w-[420px] items-center gap-3">
        <span className="w-10 text-right font-mono text-hint text-dim tabular-nums">{stamp(positionMs)}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-rule">
          <div className="h-full rounded-full bg-near" style={{ width: `${progress}%` }} />
        </div>
        <span className="w-10 font-mono text-hint text-dim tabular-nums">{stamp(durationMs)}</span>
      </div>

      <div className="mt-6 flex items-center gap-10">
        <button
          type="button"
          onClick={() => skip(-1)}
          aria-label="previous track"
          className="p-3 text-soft active:opacity-60">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
            <path d="M7 6h2.5v12H7zM18 6L9.5 12 18 18z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'pause' : 'play'}
          className="p-3 text-near active:opacity-60">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-9 w-9">
            {playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M7 5l12 7-12 7z" />}
          </svg>
        </button>
        <button
          type="button"
          onClick={() => skip(1)}
          aria-label="next track"
          className="p-3 text-soft active:opacity-60">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
            <path d="M17 6h2.5v12H17zM6 6l8.5 6L6 18z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
