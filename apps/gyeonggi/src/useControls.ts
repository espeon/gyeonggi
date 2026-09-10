import { useEffect, useRef } from 'react';

export type Controls = {
  onNext: () => void;
  onPrevious: () => void;
  onSelect: () => void;
  onMode?: () => void;
  onBack?: () => void;
};

// the rotary is a REL_HWHEEL encoder with steps-per-period=2, so chromium
// delivers one physical notch as roughly 106 (two ticks of ~53, whether they
// arrive coalesced or as separate events; the accumulator carries the half).
// quantize to the nominal notch; cap steps per event so a desktop trackpad
// fling cannot spin the whole list
const NOMINAL = 106;
const MAX_STEPS = 5;

export function useControls({ onNext, onPrevious, onSelect, onMode, onBack }: Controls) {
  const handlers = useRef<Controls>({ onNext, onPrevious, onSelect });
  handlers.current = { onNext, onPrevious, onSelect, onMode, onBack };

  useEffect(() => {
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
      acc += e.deltaX;
      let steps = Math.round(Math.abs(acc) / NOMINAL);
      if (steps > MAX_STEPS) steps = MAX_STEPS;
      if (steps === 0) return;
      acc -= Math.sign(acc) * steps * NOMINAL;
      const dir = Math.sign(e.deltaX) as 1 | -1;
      for (let i = 0; i < steps; i++) (dir === 1 ? handlers.current.onNext : handlers.current.onPrevious)();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // the dial press is the dts `select` key: KEY_ENTER
      if (e.key === 'Enter') handlers.current.onSelect();
      else if (e.key === 'm') handlers.current.onMode?.();
      else if (e.key === 'Escape') handlers.current.onBack?.();
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
