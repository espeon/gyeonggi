import { useEffect, useRef } from 'react';

export type Controls = {
  onNext: () => void;
  onPrevious: () => void;
  onSelect: () => void;
};

// the rotary is a REL_HWHEEL encoder; chromium delivers one detent as roughly
// 53, but events can coalesce (two detents, one event) or split (micro ticks).
// keep a signed carry and quantize to the nominal detent; cap steps per event
// so a trackpad fling cannot spin the whole list
const NOMINAL = 53;
const MAX_STEPS = 3;

export function useControls({ onNext, onPrevious, onSelect }: Controls) {
  const handlers = useRef({ onNext, onPrevious, onSelect });
  handlers.current = { onNext, onPrevious, onSelect };

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
      // the dial press is the dts `select` key: KEY_ENTER
      if (e.key === 'Enter' && !e.repeat) handlers.current.onSelect();
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
