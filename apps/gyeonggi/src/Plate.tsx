import { CARD_RADIUS } from './layout';

// the artwork a card is built on, plus the placeholder an app without its own icon
// falls back to. the plate tint comes from the icon so each card reads as one object
export function Plate({ cover }: { cover: { url: string; plate?: string } | null }) {
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
