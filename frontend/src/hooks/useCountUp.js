import { useEffect, useRef, useState } from 'react';

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Animates a numeric value up on change; jumps instantly when the
 *  user prefers reduced motion. Returns the display number. */
export function useCountUp(target, duration = 700) {
  const isNumber = typeof target === 'number' && Number.isFinite(target);
  const [display, setDisplay] = useState(isNumber ? target : null);
  const fromRef = useRef(isNumber ? target : 0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!isNumber) { setDisplay(null); return; }
    if (prefersReduced()) { setDisplay(target); fromRef.current = target; return; }

    const from = Number.isFinite(fromRef.current) ? fromRef.current : 0;
    if (from === target) { setDisplay(target); return; }

    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, isNumber]);

  return isNumber ? display : target;
}
