import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';

import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openMyLifeApp } from '@/services/mylifeApps';
import { MYLIFE_APPS, MYLIFE_HOME, readGlance, type MyLifeGlance } from '@/vendor/lumen';
import { useCloud } from '@/services/cloud';
import { Glass } from '@/ui/components/Glass';
import { Tap, Text, type IconName } from '@/ui/components/primitives';
import { radius, space, useTheme } from '@/ui/theme';

/**
 * Espaces MyLife : le même menu que dans les apps web (packages/ui/src/Spaces.tsx). Une feuille qui
 * monte du bas, à portée de pouce : l'accueil et les trois apps en liste (aperçu du moment, app ouverte
 * marquée « Ici », ordre fixe), puis le compte et la synchro, puis trois raccourcis.
 */

interface Target {
  id: string;
  name: string;
  line: string;
  colors: [string, string];
  icon: IconName;
  here: boolean;
  onPress: () => void;
}

function TargetRow({ t }: { t: Target }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.here ? 'Rester dans' : 'Ouvrir'} ${t.name} : ${t.line}`}
      onPress={() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        t.onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md + 2,
        minHeight: 68,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.lg,
        backgroundColor: t.here ? th.accentSoft : pressed ? th.surfaceAlt : 'transparent',
        borderWidth: t.here ? 1.5 : 0,
        borderColor: th.accent,
      })}>
      <View style={{ width: 48, height: 48, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <LinearGradient colors={t.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Ionicons name={t.icon} size={24} color="#fff" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant="bodyStrong">{t.name}</Text>
          {t.here && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 1, borderRadius: 99, backgroundColor: th.accentSoft }}>
              <Text variant="caption" tone="accent">
                Ici
              </Text>
            </View>
          )}
        </View>
        <Text variant="small" tone="secondary" numberOfLines={1}>
          {t.line}
        </Text>
      </View>
      {!t.here && <Ionicons name="chevron-forward" size={18} color={th.textMuted} />}
    </Pressable>
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
  // Comme les Espaces des apps web : le compte, puis l'état de la synchro de l'app.
  // Comme les Espaces des apps web : le compte, puis l'état de la synchro de l'app.
  const accountLine = !cloud.session ? 'Pas connecté : tout reste sur cet appareil' : cloud.recovery ? `${cloud.session.login} · clé de secours à mettre de côté` : `${cloud.session.login} · chiffré de bout en bout`;
  const accountColor = !cloud.session ? t.textMuted : cloud.recovery ? t.danger : t.success;
  const syncLine = cloud.error ?? (cloud.syncing ? 'Synchro en cours…' : !cloud.joined ? 'Appareil en cours de liaison…' : 'Synchronisé');
  const syncColor = cloud.error ? t.danger : cloud.syncing || !cloud.joined ? t.accent : t.success;
  // Aperçus déposés par les apps sur ce navigateur (web seulement : l'app Android n'y a pas accès).
  const glances = Platform.OS === 'web' && visible ? Object.fromEntries(MYLIFE_APPS.map((a) => [a.id, readGlance(a.id)])) : {};

  const targets: Target[] = [
    { id: 'home', name: MYLIFE_HOME.name, line: 'Tes apps, ton compte, l’apparence', colors: [...MYLIFE_HOME.colors], icon: 'sparkles', here: false, onPress: () => openMyLifeApp(MYLIFE_HOME.path) },
    ...MYLIFE_APPS.map<Target>((a) => {
      const g = (glances as Record<string, MyLifeGlance | null>)[a.id] ?? null;
      return { id: a.id, name: a.name, line: g ? `${g.title}${g.detail !== undefined ? ` · ${g.detail}` : ''}` : a.tagline, colors: a.colors, icon: a.icon, here: a.id === 'perf', onPress: a.id === 'perf' ? onClose : () => openMyLifeApp(a.path) };
    }),
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Fermer" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: `${t.bg}99` }]} />
      <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: space.sm, paddingBottom: Math.max(insets.bottom, space.sm) }}>
        <Glass level="lens" radius={radius.xl} style={{ width: '100%', maxWidth: 560, maxHeight: '90%' }} contentStyle={{ overflow: 'hidden', borderRadius: radius.xl }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={{ height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: t.textMuted, opacity: 0.5 }} />
          </Pressable>
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: 4 }} showsVerticalScrollIndicator={false}>
            <Text variant="label" tone="muted" style={{ paddingHorizontal: 4, paddingBottom: 4 }}>
              Aller à
            </Text>
            {targets.map((tg) => (
              <TargetRow key={tg.id} t={tg} />
            ))}
            <Text variant="label" tone="muted" style={{ paddingHorizontal: 4, paddingTop: space.md, paddingBottom: 4 }}>
              Compte et synchro
            </Text>
            <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: t.surfaceAlt }}>
              {[
                { label: 'Compte MyLife', line: accountLine, color: accountColor, show: true },
                { label: 'Synchro MyPerf', line: syncLine, color: syncColor, show: !!cloud.session },
              ]
                .filter((r) => r.show)
                .map((r, i) => (
                  <Tap key={r.label} onPress={() => go('/account')} accessibilityRole="button" accessibilityLabel={`${r.label} : ${r.line}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 58, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: t.border }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.color }} />
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyStrong">{r.label}</Text>
                        <Text variant="small" tone="secondary" numberOfLines={1}>
                          {r.line}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={17} color={t.textMuted} />
                    </View>
                  </Tap>
                ))}
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
              {actions.map(([label, icon, run]) => (
                <Tap key={label} onPress={run} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, borderRadius: radius.lg }}>
                  <View style={{ minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.lg, backgroundColor: t.surfaceAlt }}>
                    <Ionicons name={icon} size={20} color={t.accent} />
                    <Text variant="small" style={{ fontWeight: '600' }}>
                      {label}
                    </Text>
                  </View>
                </Tap>
              ))}
            </View>
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}
