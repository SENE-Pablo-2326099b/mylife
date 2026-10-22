import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openFinances } from '@/services/mylifeApps';
import { MYLIFE_APPS } from '@/vendor/lumen';
import { useCloud } from '@/services/cloud';
import { Glass } from '@/ui/components/Glass';
import { Tap, Text, type IconName } from '@/ui/components/primitives';
import { springs } from '@/ui/motion';
import { LIVE_BLUR, radius, space, useTheme } from '@/ui/theme';

/**
 * L'orbe du dock ouvre les espaces MyLife, en plein écran : les apps en grandes cartes de verre (en
 * choisir une la fait grandir jusqu'à remplir l'écran, puis on y entre), les actions du quotidien,
 * et l'état du compte. Même geste et même forme que dans MyFinances.
 */

/** Apparition échelonnée (valeur partagée, comme Reveal : sûr sur le web). */
function Rise({ index, children, style }: { index: number; children: ReactNode; style?: object }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) p.set(withDelay(40 + index * 55, withSpring(1, springs.liquid)));
  }, [index, p, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: Math.min(1, p.value * 1.5), transform: [{ translateY: (1 - p.value) * 24 }, { scale: 0.94 + p.value * 0.06 }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

function AppCard({ name, tagline, icon, colors, current, onPress }: { name: string; tagline: string; icon: IconName; colors: [string, string]; current?: boolean; onPress: () => void }) {
  const zoom = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 + zoom.value * 3 }], opacity: 1 - zoom.value, zIndex: zoom.value > 0 ? 5 : 1 }));
  return (
    <Animated.View style={[{ flex: 1, aspectRatio: 0.8 }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={current ? `${name}, ouverte` : `Ouvrir ${name}`}
        onPress={() => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          if (current) return onPress();
          zoom.set(withTiming(1, { duration: 420, easing: Easing.in(Easing.cubic) }));
          setTimeout(onPress, 380);
        }}
        style={{ flex: 1, borderRadius: radius.xl, overflow: 'hidden' }}>
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']} locations={[0, 0.55]} start={{ x: 0.1, y: 0 }} end={{ x: 0.6, y: 0.8 }} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { borderRadius: radius.xl, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', borderTopColor: 'rgba(255,255,255,0.6)' }]} />
        <View style={{ flex: 1, justifyContent: 'space-between', padding: space.lg }}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={26} color="#fff" />
          </View>
          <View style={{ gap: 2 }}>
            {current && (
              <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 4 }}>
                <Text variant="caption" style={{ color: '#fff' }}>
                  Ouverte
                </Text>
              </View>
            )}
            <Text variant="title" style={{ color: '#fff', fontSize: 22, lineHeight: 26 }}>
              {name}
            </Text>
            <Text variant="small" style={{ color: 'rgba(255,255,255,0.9)' }}>
              {tagline}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function Orbit({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const cloud = useCloud();
  const go = (path: Parameters<typeof router.push>[0]) => {
    onClose();
    setTimeout(() => router.push(path), 60);
  };
  // Même rangée dans chaque app : l'assistant, les données propres à l'app, les réglages.
  const actions: [string, IconName, () => void][] = [
    ['Coach IA', 'sparkles', () => go('/coach')],
    ['Mesures', 'body-outline', () => go('/body')],
    ['Réglages', 'options-outline', () => go('/settings')],
  ];
  const cloudLine = !cloud.session ? 'Pas connecté : tout reste sur cet appareil' : !cloud.joined ? 'Connecté, appareil à relier' : cloud.error ? cloud.error : cloud.syncing ? 'Synchro en cours…' : `${cloud.session.login} · synchronisé`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {LIVE_BLUR && <BlurView intensity={60} tint={t.blurTint} style={StyleSheet.absoluteFill} />}
      <Pressable accessibilityLabel="Fermer" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: LIVE_BLUR ? `${t.bg}99` : `${t.bg}EE` }]} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.lg, gap: space.md, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Rise index={0}>
            <Text variant="large">MyLife</Text>
          </Rise>
          <Tap onPress={onClose} accessibilityLabel="Fermer" style={{ width: 44, height: 44, borderRadius: 22 }}>
            <Glass level="float" radius={22} contentStyle={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={20} color={t.text} />
            </Glass>
          </Tap>
        </View>
        <Text variant="small" tone="secondary">
          Tes apps, un seul compte, tes données chiffrées.
        </Text>
        {/* Les apps de MyLife : même ordre et mêmes couleurs dans toutes les apps (paquet partagé). */}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {MYLIFE_APPS.map((a, i) => (
            <Rise key={a.id} index={1 + i} style={{ flex: 1 }}>
              <AppCard name={a.name} tagline={a.tagline} icon={a.icon} colors={a.colors} current={a.id === 'perf'} onPress={a.id === 'perf' ? onClose : openFinances} />
            </Rise>
          ))}
        </View>
        <Rise index={3}>
          <Tap onPress={() => go('/account')} accessibilityRole="button" style={{ borderRadius: radius.lg }}>
            <Glass level="raised" radius={radius.lg} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: cloud.error ? t.danger : cloud.joined ? t.success : t.textMuted }} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Compte MyLife</Text>
                <Text variant="small" tone="secondary" numberOfLines={1}>
                  {cloudLine}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={t.textMuted} />
            </Glass>
          </Tap>
        </Rise>
        <Rise index={4}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {actions.map(([label, icon, run]) => (
              <Tap key={label} onPress={run} accessibilityRole="button" accessibilityLabel={label} style={{ width: '31.5%', flexGrow: 1, borderRadius: radius.lg }}>
                <Glass radius={radius.lg} contentStyle={{ alignItems: 'center', gap: 6, paddingVertical: space.md + 2 }}>
                  <Ionicons name={icon} size={21} color={t.accent} />
                  <Text variant="small" style={{ fontWeight: '600' }}>
                    {label}
                  </Text>
                </Glass>
              </Tap>
            ))}
          </View>
        </Rise>
      </ScrollView>
    </Modal>
  );
}
