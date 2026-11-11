import { useEffect, useState } from 'react';

const prefersReduced = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

/**
 * Chart entrance motion, gated on the user's motion preference.
 *
 * The value is read synchronously on first render rather than flipped in an
 * effect: Recharts only resolves its animation end on a transition that starts
 * active, so mounting with `false` and switching to `true` leaves the chart in
 * a permanently "animating" state (which also suppresses line dots).
 */
export function useChartMotion() {
  const [animate, setAnimate] = useState(() => !prefersReduced());

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const onChange = () => setAnimate(!mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return animate;
}

export default useChartMotion;
