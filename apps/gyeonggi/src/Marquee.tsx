import { useLayoutEffect, useRef, useState } from 'react';

// the now-playing line runs as a ticker once it outgrows the bar: hold, scroll one
// pass, and wrap onto a second copy of itself so the join is seamless. the hold is a
// keyframe segment rather than a delay, so it repeats every pass instead of once.
// distances are px rather than -50% so the keyframes do not depend on the second copy
const MARQUEE_GAP = 48;
const MARQUEE_SPEED = 40;
const MARQUEE_HOLD = 1;

// takes whatever width its flex parent leaves it, and sits still unless the text is
// wider than that. the type comes from the caller, since both copies inherit it
export function Marquee({ text, className = 'text-hero text-muted' }: { text: string; className?: string }) {
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
    <span ref={viewport} className={`min-w-0 flex-1 overflow-hidden ${className}`}>
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
