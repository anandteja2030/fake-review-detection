import { useEffect, useRef } from 'react';

/**
 * Ambient depth layer: volumetric light blooms, a perspective grid and a slow
 * particle field. Purely decorative (aria-hidden), pointer-transparent, and
 * disabled entirely for reduced-motion users.
 */
export default function Atmosphere() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles = [];
    let visible = true;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = width < 720 ? 26 : 58;
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.5 + 0.35,
        vx: (Math.random() - 0.5) * 0.09,
        vy: (Math.random() - 0.5) * 0.07,
        a: Math.random() * 0.4 + 0.1,
        hue: Math.random() > 0.55 ? '167,139,250' : '80,220,255'
      }));
    };

    const draw = () => {
      if (!visible) return;
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 7);
        glow.addColorStop(0, `rgba(${p.hue},${p.a})`);
        glow.addColorStop(1, `rgba(${p.hue},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(210,240,255,${p.a * 0.9})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      if (visible) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="app-atmosphere" aria-hidden="true">
      <span className="atmo-blob a" />
      <span className="atmo-blob b" />
      <span className="atmo-blob c" />
      <span className="atmo-grid" />
      <canvas ref={canvasRef} />
      <span className="atmo-grain" />
      <span className="atmo-vignette" />
    </div>
  );
}
