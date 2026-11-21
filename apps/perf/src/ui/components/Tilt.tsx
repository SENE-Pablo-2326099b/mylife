import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * Verre en relief sur le web (PWA MyLife), comme Tilt de MyFinances : la carte s'incline de quelques
 * degrés vers le pointeur (ordinateur) ou suit l'inclinaison du téléphone (gyroscope, Android), et un
 * reflet glisse à sa surface dans le sens opposé. Mis à jour une fois par image, hors de React.
 */
const MAX = 5;
const RADIUS = 28;

export function Tilt({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const outer = useRef<View>(null);
  const inner = useRef<View>(null);
  const glare = useRef<View>(null);

  useEffect(() => {
    const host = outer.current as unknown as HTMLElement | null;
    const card = inner.current as unknown as HTMLElement | null;
    const shine = glare.current as unknown as HTMLElement | null;
    if (reduce || !host || !card || !shine) return;
    host.style.perspective = '900px';
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    let base: { b: number; g: number } | null = null;
    const paint = () => {
      raf = 0;
      x += (tx - x) * 0.14;
      y += (ty - y) * 0.14;
      card.style.transform = `rotateX(${(-y * MAX).toFixed(2)}deg) rotateY(${(x * MAX).toFixed(2)}deg)`;
      shine.style.background = `radial-gradient(70% 60% at ${(50 - x * 30).toFixed(1)}% ${(45 - y * 35).toFixed(1)}%, rgba(255,255,255,0.13), transparent 60%)`;
      if (Math.abs(tx - x) > 0.002 || Math.abs(ty - y) > 0.002) raf = requestAnimationFrame(paint);
    };
    const go = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      base ??= { b: e.beta, g: e.gamma };
      tx = Math.max(-1, Math.min(1, (e.gamma - base.g) / 18));
      ty = Math.max(-1, Math.min(1, (e.beta - base.b) / 18));
      go();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = host.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      go();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      go();
    };
    // iOS demande une permission explicite : seul le pointeur y anime la carte.
    const needsPermission = typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';
    if (!needsPermission) window.addEventListener('deviceorientation', onTilt);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    go();
    return () => {
      window.removeEventListener('deviceorientation', onTilt);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduce]);

  if (reduce) return <View style={style}>{children}</View>;
  return (
    <View ref={outer} style={style}>
      <View ref={inner} style={{ flex: 1 }}>
        {children}
        <View ref={glare} pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: RADIUS, mixBlendMode: 'screen' } as ViewStyle]} />
      </View>
    </View>
  );
}
