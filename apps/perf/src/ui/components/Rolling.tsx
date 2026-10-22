import { useEffect, useState } from 'react';
import { Platform, Text as RNText, View, type TextStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * Chiffres qui roulent : chaque chiffre est une petite colonne 0-9 qui glisse jusqu'à sa valeur,
 * comme un compteur mécanique (thread UI, sans re-rendu React pendant le mouvement). Alignées depuis
 * la droite : les unités restent en place. `mount` : défile aussi à la première apparition.
 * Même composant et même ressenti que dans MyFinances.
 */
function Digit({ value, style, lineHeight }: { value: number; style: TextStyle; lineHeight: number }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(reduce ? -value * lineHeight : 0);
  useEffect(() => {
    y.set(reduce ? -value * lineHeight : withTiming(-value * lineHeight, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [value, lineHeight, reduce, y]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height: lineHeight, overflow: 'hidden' }}>
      <RNText style={[style, { lineHeight, opacity: 0 }]}>0</RNText>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, anim]}>
        {'0123456789'.split('').map((d) => (
          <RNText key={d} style={[style, { lineHeight, height: lineHeight }]}>
            {d}
          </RNText>
        ))}
      </Animated.View>
    </View>
  );
}

export function Rolling({ text, style, lineHeight, mount = true }: { text: string; style: TextStyle; lineHeight: number; mount?: boolean }) {
  const [shown, setShown] = useState(mount ? text.replace(/\d/g, '0') : text);
  useEffect(() => {
    const id = setTimeout(() => setShown(text), mount ? 30 : 0);
    return () => clearTimeout(id);
  }, [text, mount]);
  const chars = [...shown];
  return (
    <View accessible accessibilityLabel={text} style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      {chars.map((c, i) => {
        const key = chars.length - i;
        return /\d/.test(c) ? (
          <Digit key={`d${key}`} value={Number(c)} style={style} lineHeight={lineHeight} />
        ) : (
          <RNText key={`s${key}${c}`} style={[style, { lineHeight }, Platform.OS === 'web' ? { whiteSpace: 'pre' } as TextStyle : null]}>
            {c}
          </RNText>
        );
      })}
    </View>
  );
}
