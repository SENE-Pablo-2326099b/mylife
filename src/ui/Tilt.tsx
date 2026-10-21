import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Verre en relief : la carte s'incline légèrement vers le pointeur (ordinateur) ou suit l'inclinaison
 * du téléphone (gyroscope, Android), et un reflet glisse à sa surface dans le sens opposé, comme une
 * vraie plaque qui accroche la lumière. Inclinaison bornée à quelques degrés, ressorts amortis.
 */
const MAX = 5;

export function Tilt({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const nx = useMotionValue(0);
  const ny = useMotionValue(0);
  const sx = useSpring(nx, { stiffness: 140, damping: 18, mass: 0.6 });
  const sy = useSpring(ny, { stiffness: 140, damping: 18, mass: 0.6 });
  const rotateY = useTransform(sx, [-1, 1], [-MAX, MAX]);
  const rotateX = useTransform(sy, [-1, 1], [MAX, -MAX]);
  const glareX = useTransform(sx, [-1, 1], ['80%', '20%']);
  const glareY = useTransform(sy, [-1, 1], ['80%', '10%']);
  const glare = useTransform([glareX, glareY], ([x, y]) => `radial-gradient(70% 60% at ${x as string} ${y as string}, rgba(255,255,255,0.13), transparent 60%)`);

  useEffect(() => {
    if (reduce) return;
    let base: { b: number; g: number } | null = null;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      base ??= { b: e.beta, g: e.gamma };
      nx.set(Math.max(-1, Math.min(1, (e.gamma - base.g) / 18)));
      ny.set(Math.max(-1, Math.min(1, (e.beta - base.b) / 18)));
    };
    // iOS demande une permission explicite : seul le pointeur y anime la carte.
    const needsPermission = typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';
    if (!needsPermission) window.addEventListener('deviceorientation', onTilt);
    return () => window.removeEventListener('deviceorientation', onTilt);
  }, [reduce, nx, ny]);

  if (reduce) return <div className={className}>{children}</div>;
  return (
    <div style={{ perspective: 900 }} className={className}>
      <motion.div
        ref={ref}
        className="relative h-full"
        style={{ rotateX, rotateY }}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return;
          const r = ref.current?.getBoundingClientRect();
          if (!r) return;
          nx.set(((e.clientX - r.left) / r.width) * 2 - 1);
          ny.set(((e.clientY - r.top) / r.height) * 2 - 1);
        }}
        onPointerLeave={() => {
          nx.set(0);
          ny.set(0);
        }}
      >
        {children}
        <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-lg" style={{ background: glare, mixBlendMode: 'screen' }} />
      </motion.div>
    </div>
  );
}
