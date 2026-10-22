import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listExercises } from '@/db/repos/exercises';
import { searchKey } from '@/domain/text';
import { openFinances } from '@/services/mylifeApps';
import { Glass } from '@/ui/components/Glass';
import { Text, type IconName } from '@/ui/components/primitives';
import { family, LIVE_BLUR, radius, space, useTheme } from '@/ui/theme';

/**
 * Palette de commande : une seule porte vers tout, comme dans MyFinances. On tape quelques lettres et
 * on y est — un écran, une action, un exercice — ou on prépare une question pour le coach.
 */

interface Item {
  id: string;
  group: 'Actions' | 'Aller à' | 'Exercices' | 'Coach';
  icon: IconName;
  title: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

export function CommandPalette({ visible, onClose, onSpaces }: { visible: boolean; onClose: () => void; onSpaces: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const q = searchKey(query.trim());
  // Liste lue à l'ouverture (SQLite, synchrone) : jamais pendant que la palette est fermée.
  const exercises = useMemo(() => (visible ? listExercises() : []), [visible]);

  const close = () => {
    setQuery('');
    onClose();
  };
  const go = (path: Href) => () => {
    close();
    setTimeout(() => router.push(path), 40);
  };

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { id: 'a-today', group: 'Actions', icon: 'play', title: 'Séance du jour', keywords: 'démarrer entraînement', run: go('/') },
      { id: 'a-coach', group: 'Actions', icon: 'sparkles', title: 'Parler au coach', keywords: 'ia claude conseil', run: go('/coach') },
      { id: 'a-body', group: 'Actions', icon: 'body-outline', title: 'Ajouter une mesure', keywords: 'poids corps pesée', run: go('/body') },
      { id: 'a-spaces', group: 'Actions', icon: 'planet-outline', title: 'Espaces MyLife', keywords: 'apps compte', run: () => {
          close();
          setTimeout(onSpaces, 60);
        } },
      { id: 'a-fin', group: 'Actions', icon: 'wallet-outline', title: 'Ouvrir MyFinances', keywords: 'budget argent', run: () => {
          close();
          openFinances();
        } },
    ];
    const pages: Item[] = [
      { id: 'p-planning', group: 'Aller à', icon: 'calendar-clear-outline', title: 'Planning', keywords: 'cycle semaine mésocycle', run: go('/planning') },
      { id: 'p-exercises', group: 'Aller à', icon: 'barbell-outline', title: 'Exercices', keywords: 'bibliothèque', run: go('/exercises') },
      { id: 'p-stats', group: 'Aller à', icon: 'pulse-outline', title: 'Stats', keywords: 'progression volume 1rm', run: go('/stats') },
      { id: 'p-settings', group: 'Aller à', icon: 'options-outline', title: 'Réglages', keywords: 'paramètres thème', run: go('/settings') },
      { id: 'p-account', group: 'Aller à', icon: 'lock-closed-outline', title: 'Compte MyLife', keywords: 'synchro appareils', run: go('/account') },
    ];
    const match = (i: Item) => !q || searchKey(`${i.title} ${i.keywords ?? ''}`).includes(q);
    const ex: Item[] = q
      ? exercises
          .filter((e) => searchKey(e.name).includes(q))
          .slice(0, 6)
          .map((e) => ({ id: `e-${e.id}`, group: 'Exercices', icon: 'barbell-outline', title: e.name, hint: 'Fiche, historique, 1RM', run: go(`/exercise/${e.id}`) }))
      : [];
    const ask: Item[] = q ? [{ id: 'ask', group: 'Coach', icon: 'sparkles', title: `Demander : « ${query.trim()} »`, hint: 'Préparée dans le coach, tu relis avant d’envoyer', run: go({ pathname: '/coach', params: { q: query.trim() } }) }] : [];
    return [...actions.filter(match), ...pages.filter(match), ...ex, ...ask];
  }, [q, query, exercises]); // eslint-disable-line react-hooks/exhaustive-deps

  let lastGroup = '';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      {LIVE_BLUR && <BlurView intensity={50} tint={t.blurTint} style={StyleSheet.absoluteFill} />}
      <Pressable accessibilityLabel="Fermer" onPress={close} style={[StyleSheet.absoluteFill, { backgroundColor: LIVE_BLUR ? `${t.bg}8C` : `${t.bg}EB` }]} />
      <View pointerEvents="box-none" style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.sm + 2, maxWidth: 640, width: '100%', alignSelf: 'center', flex: 1, paddingBottom: insets.bottom + space.lg }}>
        <Glass level="lens" radius={radius.xl} style={{ maxHeight: '100%' }} contentStyle={{ overflow: 'hidden', borderRadius: radius.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }}>
            <Ionicons name="search" size={20} color={t.accent} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Chercher, aller, agir, demander…"
              placeholderTextColor={t.textMuted}
              returnKeyType="go"
              onSubmitEditing={() => items[0]?.run()}
              accessibilityLabel="Chercher, aller, agir, demander"
              style={[{ flex: 1, height: 58, color: t.text, fontFamily: family.medium, fontSize: 17 }, Platform.OS === 'web' ? ({ outlineWidth: 0 } as TextStyle) : null]}
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.sm }}>
            {items.length === 0 && (
              <Text tone="muted" style={{ textAlign: 'center', padding: space.xl }}>
                Rien de trouvé.
              </Text>
            )}
            {items.map((it) => {
              const head = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              return (
                <View key={it.id}>
                  {head !== null && (
                    <Text variant="label" tone="muted" style={{ paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.xs }}>
                      {head}
                    </Text>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={it.title}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      it.run();
                    }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: pressed ? t.accentSoft : 'transparent' })}>
                    <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={it.icon} size={17} color={t.textSecondary} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {it.title}
                      </Text>
                      {it.hint !== undefined && (
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {it.hint}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}
