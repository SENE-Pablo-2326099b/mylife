import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, Text as RNText, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { formatWeight } from '@/domain/math';
import { barbellPlates, beltPlates, describePlates } from '@/domain/plates';
import { useShallow } from 'zustand/react/shallow';

import { useEntry, type EntryFocus, type KeypadKey } from '@/state/entryStore';
import { useWorkoutStore } from '@/state/workoutStore';
import { Tap, Text } from '@/ui/components/primitives';
import { fadeIn, flowAnim } from '@/ui/motion';
import { family, radius, shade, space, useTheme } from '@/ui/theme';

const KEY_H = 52;

function Key({ children, onPress, tone = 'digit', label }: { children: ReactNode; onPress: () => void; tone?: 'digit' | 'action' | 'primary'; label: string }) {
  const t = useTheme();
  const primary = tone === 'primary';
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.9}
      highlightRadius={radius.md}
      style={{
        flex: 1,
        height: KEY_H,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: primary ? 'transparent' : tone === 'action' ? t.surfaceAlt : t.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: primary ? 'transparent' : t.border,
        boxShadow: shade(primary ? `0px 6px 20px ${t.accentGlow}, inset 0px 1px 0px ${t.highlight}` : `inset 0px 1px 0px ${t.glass.pane.specular}`, true),
      }}>
      {primary && <LinearGradient colors={t.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </Tap>
  );
}

/** Live readout for the focused cell: what you are typing, big, where your eyes already are. */
function useFocusContext(focus: EntryFocus | null) {
  // Shallow-compared: a fresh object each time would re-render forever.
  return useWorkoutStore(useShallow((s) => {
    if (focus === null) return null;
    const doc = s.docs[focus.workoutId];
    const item = doc?.items.find((i) => i.sets.some((x) => x.id === focus.setId));
    const set = item?.sets.find((x) => x.id === focus.setId);
    if (item === undefined || doc === undefined || set === undefined) return null;
    const n = item.sets.filter((x) => x.setType !== 'warmup').indexOf(set) + 1;
    return {
      name: item.exercise.name,
      increment: formatWeight(item.exercise.weightIncrement ?? doc.settings.increment),
      setLabel: set.setType === 'warmup' ? 'Échauffement' : `Série ${n}`,
      weight: set.weight ?? set.targetWeight,
      reps: set.reps ?? set.targetReps,
      weightTyped: set.weight !== null,
      repsTyped: set.reps !== null,
      // Plate calculator: barbells get plates per side, weighted dips/pull-ups a belt.
      plateMode: item.exercise.equipment === 'barbell' ? 'bar' : item.exercise.loadType === 'bodyweight' ? 'belt' : null,
      barWeight: doc.settings.barWeight,
      plates: doc.settings.plates.join(','),
    };
  }));
}

/**
 * The numeric keypad. Rendered inside the floating dock (phones) or the session panel (desktop).
 * Also answers to a physical keyboard on the web (digits, ⌫, ↑/↓, Tab, Enter, Esc).
 */
export function Keypad({ host }: { host: 'tabs' | 'screen' }) {
  const t = useTheme();
  const focus = useEntry((s) => (s.focus?.host === host ? s.focus : null));
  const buffer = useEntry((s) => s.buffer);
  const fresh = useEntry((s) => s.fresh);
  const press = useEntry((s) => s.key);
  const close = useEntry((s) => s.close);
  const open = useEntry((s) => s.open);
  const ctx = useFocusContext(focus);
  if (focus === null) return null;
  const isWeight = focus.field === 'weight';
  const k = (key: KeypadKey) => () => press(key);

  const display = (field: 'weight' | 'reps') => {
    const active = focus.field === field;
    if (active && !fresh) return { text: buffer === '' ? '0' : buffer.replace('.', ','), typed: true };
    const v = field === 'weight' ? ctx?.weight : ctx?.reps;
    const typed = field === 'weight' ? ctx?.weightTyped : ctx?.repsTyped;
    return { text: v === null || v === undefined ? '–' : field === 'weight' ? formatWeight(v) : String(v), typed: typed === true };
  };

  const readout = (field: 'weight' | 'reps', label: string, unit: string) => {
    const active = focus.field === field;
    const d = display(field);
    return (
      <Tap
        onPress={() => open({ ...focus, field })}
        scaleTo={0.97}
        highlightRadius={radius.md}
        accessibilityLabel={`Saisir ${label}`}
        style={{
          flex: 1,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          backgroundColor: active ? t.accentSoft : 'transparent',
          borderWidth: 1,
          borderColor: active ? `${t.accent}77` : 'transparent',
          boxShadow: shade(active ? `0px 0px 22px ${t.accentGlow}` : undefined, true),
        }}>
        <Text variant="label" tone={active ? 'accent' : 'muted'} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <RNText maxFontSizeMultiplier={1.15} style={{ fontFamily: family.display, fontSize: 30, letterSpacing: -0.8, color: d.typed ? t.text : t.ghost }} numberOfLines={1}>
            {d.text}
          </RNText>
          {active && !fresh && <RNText maxFontSizeMultiplier={1.15} style={{ color: t.accent, fontSize: 28, fontFamily: family.regular }}>|</RNText>}
          <Text variant="small" tone="muted" maxFontSizeMultiplier={1.2}>
            {unit}
          </Text>
        </View>
      </Tap>
    );
  };

  const digit = (d: string) => (
    <Key onPress={k({ type: 'digit', value: d })} label={d}>
      <RNText maxFontSizeMultiplier={1.15} style={{ color: t.text, fontSize: 24, fontFamily: family.displaySemi }}>{d}</RNText>
    </Key>
  );

  // Load being typed (or prescribed) → plates to put on.
  const typedWeight = isWeight && !fresh && buffer !== '' ? Number(buffer) : (ctx?.weight ?? null);
  let plateLine: string | null = null;
  if (ctx !== null && ctx.plateMode !== null && typedWeight !== null && Number.isFinite(typedWeight) && typedWeight > 0) {
    const available = ctx.plates.split(',').map(Number);
    const load = ctx.plateMode === 'bar' ? barbellPlates(typedWeight, ctx.barWeight, available) : beltPlates(typedWeight, available);
    const what = ctx.plateMode === 'bar' ? 'Par côté' : 'Ceinture';
    plateLine = load.belowBar
      ? `Sous la barre à vide (${formatWeight(ctx.barWeight)} kg)`
      : load.plates.length === 0
        ? 'Barre à vide'
        : `${what} : ${describePlates(load.plates)}${Math.abs(load.loaded - typedWeight) > 0.001 ? ` (= ${formatWeight(load.loaded)} kg)` : ''}`;
  }

  return (
    <Animated.View entering={flowAnim(fadeIn(60))} style={{ padding: space.sm + 2, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="secondary" numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {ctx?.name ?? ''} · {ctx?.setLabel ?? ''}
          </Text>
        </View>
        <Tap onPress={close} hitSlop={10} accessibilityLabel="Fermer le clavier" scaleTo={0.85} highlightRadius={16} style={{ padding: 4, borderRadius: 16 }}>
          <Ionicons name="chevron-down" size={22} color={t.textSecondary} />
        </Tap>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {readout('weight', 'Poids', 'kg')}
        {readout('reps', 'Reps', '')}
      </View>
      {plateLine !== null && (
        <View
          accessibilityLabel={`Disques : ${plateLine}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm, minHeight: 22 }}>
          <Ionicons name="disc-outline" size={14} color={t.gold} />
          <Text variant="small" tone="secondary" numberOfLines={1} style={{ flex: 1 }} maxFontSizeMultiplier={1.2}>
            {plateLine}
          </Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {digit('1')}
        {digit('2')}
        {digit('3')}
        <Key tone="action" onPress={k({ type: 'step', direction: -1 })} label={isWeight ? `Moins ${ctx?.increment ?? ''} kg` : 'Moins une rep'}>
          <RNText maxFontSizeMultiplier={1.15} style={{ color: t.text, fontSize: 16, fontFamily: family.semibold }}>−{isWeight ? ctx?.increment : '1'}</RNText>
        </Key>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {digit('4')}
        {digit('5')}
        {digit('6')}
        <Key tone="action" onPress={k({ type: 'step', direction: 1 })} label={isWeight ? `Plus ${ctx?.increment ?? ''} kg` : 'Plus une rep'}>
          <RNText maxFontSizeMultiplier={1.15} style={{ color: t.text, fontSize: 16, fontFamily: family.semibold }}>+{isWeight ? ctx?.increment : '1'}</RNText>
        </Key>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {digit('7')}
        {digit('8')}
        {digit('9')}
        <Key tone="action" onPress={k({ type: 'next' })} label={isWeight ? 'Passer aux répétitions' : 'Série suivante'}>
          <RNText maxFontSizeMultiplier={1.15} style={{ color: t.text, fontSize: 14, fontFamily: family.semibold }}>{isWeight ? 'Reps →' : 'Suiv. →'}</RNText>
        </Key>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Key onPress={k({ type: 'dot' })} label="Virgule">
          <RNText maxFontSizeMultiplier={1.15} style={{ color: isWeight ? t.text : t.textMuted, fontSize: 24, fontFamily: family.displaySemi }}>,</RNText>
        </Key>
        {digit('0')}
        <Key onPress={k({ type: 'backspace' })} label="Effacer">
          <Ionicons name="backspace-outline" size={23} color={t.text} />
        </Key>
        <Key tone="primary" onPress={k({ type: 'validate' })} label="Valider la série">
          <Ionicons name="checkmark" size={28} color={t.onAccent} />
        </Key>
      </View>
    </Animated.View>
  );
}

/** Physical keyboard on the web: type sets without touching the mouse. */
export function useKeypadShortcuts(): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const { focus, key, close } = useEntry.getState();
      if (focus === null) return;
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      let handled = true;
      if (/^[0-9]$/.test(e.key)) key({ type: 'digit', value: e.key });
      else if (e.key === '.' || e.key === ',') key({ type: 'dot' });
      else if (e.key === 'Backspace') key({ type: 'backspace' });
      else if (e.key === 'ArrowUp') key({ type: 'step', direction: 1 });
      else if (e.key === 'ArrowDown') key({ type: 'step', direction: -1 });
      else if (e.key === 'Tab') key({ type: 'next' });
      else if (e.key === 'Enter') key({ type: 'validate' });
      else if (e.key === 'Escape') close();
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
