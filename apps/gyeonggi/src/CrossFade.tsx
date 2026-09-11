import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

type Props = {
  contentKey: string;
  timeout?: number;
  style?: CSSProperties;
  children: ReactNode;
};

type AnimationState = {
  fromNode: ReactNode | null;
  toNode: ReactNode | null;
  swapped: boolean;
};

// two opacity halves stacked in one grid cell, so a change blends instead of cutting and
// neither half moves the other. the outgoing half stays mounted for the fade, which is
// what makes this a crossfade rather than a fade-in. the styling lives in index.css
export function CrossFade({ contentKey, timeout = 400, style, children }: Props) {
  // the layer elements, for the caller's own transitions during a fade
  const firstNode = useRef<HTMLElement | null>(null);
  const secondNode = useRef<HTMLElement | null>(null);

  // tracks when a fade is in progress so the outgoing half can be dropped afterwards
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animationState = useRef<AnimationState>({ fromNode: null, toNode: children, swapped: false });

  const [previousContentKey, setPreviousContentKey] = useState(contentKey);
  const [previousChildren, setPreviousChildren] = useState(children);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (contentKey === previousContentKey) return;
    // alternate which half holds the incoming content, so the outgoing half is the one
    // that stays in place rather than being remounted
    animationState.current = {
      fromNode: previousChildren,
      toNode: children,
      swapped: !animationState.current.swapped,
    };
    setAnimating(true);
    if (animationTimer.current) clearTimeout(animationTimer.current);
    animationTimer.current = setTimeout(() => setAnimating(false), timeout);
  }, [contentKey, previousContentKey, children, previousChildren, timeout]);

  // a pending timer must not outlive the component
  useEffect(
    () => () => {
      if (animationTimer.current) clearTimeout(animationTimer.current);
    },
    [],
  );

  useEffect(() => {
    setPreviousChildren(children);
  }, [children]);

  useEffect(() => {
    setPreviousContentKey(contentKey);
  }, [contentKey]);

  const { swapped, fromNode, toNode } = animationState.current;
  // a changed key shows its fade before the effect that starts the timer has run
  const isAnimating = animating || contentKey !== previousContentKey;
  const layer = { transition: `opacity ${timeout}ms ease-in-out` };

  return (
    <div className="cross-fade" style={style}>
      <div
        ref={node => {
          firstNode.current = node;
        }}
        className={`cross-fade-layer ${swapped ? 'cross-fade-in' : 'cross-fade-out'}`}
        style={layer}>
        {swapped ? (isAnimating ? toNode : children) : isAnimating ? fromNode : null}
      </div>
      <div
        ref={node => {
          secondNode.current = node;
        }}
        className={`cross-fade-layer ${swapped ? 'cross-fade-out' : 'cross-fade-in'}`}
        style={layer}>
        {swapped ? (isAnimating ? fromNode : null) : isAnimating ? toNode : children}
      </div>
    </div>
  );
}
