import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import type { ThemeId } from '@/db/repos/settings';
import { Tap, Text } from '@/ui/components/primitives';
import { radius, space, themePalette, useTheme } from '@/ui/theme';
import { THEMES } from '@/ui/themes';

/** A theme in miniature: its field, a glass card with a title line, a set row and its accent. */
function Preview({ id }: { id: ThemeId }) {
  const p = themePalette(id);
  return (
    <LinearGradient colors={p.field} style={{ height: 92, borderRadius: radius.md, padding: 8, overflow: 'hidden', justifyContent: 'flex-end' }}>
      <View style={{ position: 'absolute', top: -18, right: -14, width: 64, height: 64, borderRadius: 32, backgroundColor: p.halos.violet, opacity: 0.35 }} />
      <View style={{ position: 'absolute', top: 18, left: -20, width: 48, height: 48, borderRadius: 24, backgroundColor: p.halos.gold, opacity: 0.22 }} />
      <View style={{ borderRadius: 10, padding: 7, gap: 5, backgroundColor: p.glass.raised.solidFill, borderWidth: StyleSheet.hairlineWidth, borderColor: p.glass.raised.rim }}>
        <View style={{ height: 5, width: '62%', borderRadius: 3, backgroundColor: p.text, opacity: 0.85 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.gold }} />
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: p.textMuted }} />
          <View style={{ width: 16, height: 12, borderRadius: 4, backgroundColor: p.well }} />
          <LinearGradient colors={p.accentGradient} style={{ width: 14, height: 12, borderRadius: 4 }} />
        </View>
      </View>
    </LinearGradient>
  );
}

/** Theme choice: every theme previewed in miniature; a tap applies it at once. */
export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {THEMES.map((th) => {
        const selected = th.id === value;
        return (
          <Tap
            key={th.id}
            onPress={() => onChange(th.id)}
            scaleTo={0.96}
            highlightRadius={radius.lg}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`Thème ${th.name} : ${th.description}`}
            style={{
              flexGrow: 1,
              flexBasis: 140,
              maxWidth: '49%',
              padding: 5,
              borderRadius: radius.lg,
              borderWidth: 2,
              borderColor: selected ? t.accent : 'transparent',
            }}>
            <Preview id={th.id} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingTop: 6, paddingBottom: 2 }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {th.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {th.description}
                </Text>
              </View>
              {selected && <Ionicons name="checkmark-circle" size={20} color={t.accent} />}
            </View>
          </Tap>
        );
      })}
    </View>
  );
}
