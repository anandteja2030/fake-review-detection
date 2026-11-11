import { useEffect, useRef } from 'react';

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Cinematic hero visual: luminous core, layered rings, a handful of
 * orbiting particles. Pure CSS/SVG motion — no canvas loop, no WebGL.
 * Gentle pointer parallax on mouse devices only (never required for
 * touch); fully disabled under prefers-reduced-motion.
 */
export default function AiOrb({ caption = 'stacking ensemble · live' }) {
  const stageRef = useRef(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || prefersReduced()) return;
    let raf = 0;
    const onMove = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return; // touch: no tilt needed
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--ty', `${(px * 10).toFixed(2)}deg`);
        el.style.setProperty('--tx', `${(-py * 8).toFixed(2)}deg`);
      });
    };
    const onLeave = () => {
      el.style.setProperty('--tx', '0deg');
      el.style.setProperty('--ty', '0deg');
    };
    const host = el.closest('.hero-visual') || el;
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const dots = [
    { a0: 20, r: 'calc(min(232px, 66vw) * 0.33)', dur: '11s', violet: false },
    { a0: 140, r: 'calc(min(232px, 66vw) * 0.33)', dur: '11s', violet: true, delay: '-5.5s' },
    { a0: 260, r: 'calc(min(232px, 66vw) * 0.42)', dur: '17s', violet: false, delay: '-4s' },
    { a0: 60, r: 'calc(min(232px, 66vw) * 0.42)', dur: '17s', violet: true, delay: '-12s' },
    { a0: 300, r: 'calc(min(232px, 66vw) * 0.49)', dur: '24s', violet: false, delay: '-8s' },
    { a0: 110, r: 'calc(min(232px, 66vw) * 0.49)', dur: '24s', violet: true, delay: '-19s' },
    { a0: 200, r: 'calc(min(232px, 66vw) * 0.37)', dur: '29s', violet: false, delay: '-15s', sm: true },
    { a0: 340, r: 'calc(min(232px, 66vw) * 0.45)', dur: '31s', violet: true, delay: '-23s', sm: true }
  ];

  return (
    <div className="hero-visual" aria-hidden="true">
      <div className="orb-stage" ref={stageRef}>
        <span className="orb-ring r1" />
        <span className="orb-ring r2" />
        <span className="orb-ring r3" />
        <span className="orb-core" />
        {dots.map((d, i) => (
          <span
            key={i}
            className={`orb-dot${d.violet ? ' violet' : ''}${d.sm ? ' sm' : ''}`}
            style={{
              '--a0': `${d.a0}deg`,
              '--r': d.r,
              '--dur': d.dur,
              animationDelay: d.delay || '0s'
            }}
          />
        ))}
        <span className="orb-caption">{caption}</span>
      </div>
    </div>
  );
}
