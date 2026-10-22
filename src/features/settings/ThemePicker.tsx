import Ionicons from '@expo/vector-icons/Ionicons';
import { isLoaded } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { View, type ViewStyle } from 'react-native';

import type { ThemeId } from '@/db/repos/settings';
import { Tap, Text } from '@/ui/components/primitives';
import { radius, space, themePalette, useTheme } from '@/ui/theme';
import { themeInfo, THEMES } from '@/ui/themes';
import { STYLES } from '@/vendor/lumen';

/** Police de titre de chaque identité, quand elle est déjà chargée (sinon, celle du système). */
const DISPLAY: Record<string, string> = { lumen: 'Sora_700Bold', circuit: 'SpaceGrotesk_700Bold', ardoise: 'IBMPlexSans_600SemiBold', argile: 'Nunito_800ExtraBold', brut: 'Archivo_900Black' };

/** Le fond, la carte et le bouton d'un thème en miniature, dessinés avec sa propre identité (comme MyFinances). */
function Preview({ id }: { id: ThemeId }) {
  const p = themePalette(id);
  const st = STYLES[themeInfo(id).style];
  const ink = p.text;
  const card: ViewStyle =
    st.card === 'brutal'
      ? { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: ink, boxShadow: `3px 3px 0px ${ink}`, borderRadius: 5 }
      : st.card === 'clay'
        ? { backgroundColor: p.glass.raised.fill, boxShadow: `4px 5px 10px ${p.accent}33, -3px -3px 8px rgba(255,255,255,0.9)`, borderRadius: 16 }
        : st.card === 'outline'
          ? { backgroundColor: p.glass.raised.solidFill, borderWidth: 1, borderColor: `${p.accent}99`, boxShadow: `0px 0px 12px -2px ${p.accentGlow}`, borderRadius: 3 }
          : st.card === 'solid'
            ? { backgroundColor: p.glass.raised.fill, borderWidth: 1, borderColor: p.glass.raised.rim, borderRadius: 6 }
            : { backgroundColor: p.glass.raised.solidFill, borderWidth: 1, borderColor: p.glass.raised.rim, borderRadius: 10 };
  const button: ViewStyle =
    st.button === 'brutal'
      ? { backgroundColor: p.accent, borderWidth: 1.5, borderColor: ink, borderRadius: 999 }
      : st.button === 'outline'
        ? { borderWidth: 1, borderColor: p.accent, borderRadius: 2 }
        : st.button === 'solid'
          ? { backgroundColor: p.accent, borderRadius: 3 }
          : { backgroundColor: p.accentGradient[1], borderRadius: 999 };
  const halos = st.backdrop === 'halos' || st.backdrop === 'blobs';
  const font = DISPLAY[st.id];
  return (
    <LinearGradient colors={p.field} style={{ height: 92, borderRadius: radius.md, padding: 8, overflow: 'hidden', justifyContent: 'flex-end' }}>
      {halos && <View style={{ position: 'absolute', top: -18, right: -14, width: 64, height: 64, borderRadius: 32, backgroundColor: p.halos.violet, opacity: 0.35 }} />}
      {halos && <View style={{ position: 'absolute', top: 18, left: -20, width: 48, height: 48, borderRadius: 24, backgroundColor: p.halos.gold, opacity: 0.22 }} />}
      <Text
        style={{ position: 'absolute', top: 6, left: 10, fontSize: 19, lineHeight: 22, color: ink, fontFamily: font !== undefined && isLoaded(font) ? font : undefined, fontWeight: font !== undefined && isLoaded(font) ? undefined : '800', textTransform: st.labelCase === 'upper' ? 'uppercase' : 'none' }}
        accessibilityElementsHidden
        importantForAccessibility="no">
        Aa
      </Text>
      <View style={[{ padding: 7, gap: 5 }, card]}>
        <View style={{ height: 5, width: '62%', borderRadius: 3, backgroundColor: ink, opacity: 0.85 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.gold }} />
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: p.textMuted }} />
          <View style={[{ width: 24, height: 12 }, button]} />
        </View>
      </View>
    </LinearGradient>
  );
}

function Tile({ id, selected, onChange }: { id: ThemeId; selected: boolean; onChange: (id: ThemeId) => void }) {
  const t = useTheme();
  const th = themeInfo(id);
  return (
    <Tap
      onPress={() => onChange(id)}
      scaleTo={0.96}
      highlightRadius={radius.lg}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`Thème ${th.name} : ${th.description}`}
      style={{ flexGrow: 1, flexBasis: 140, maxWidth: '49%', padding: 5, borderRadius: radius.lg, borderWidth: 2, borderColor: selected ? t.accent : 'transparent' }}>
      <Preview id={id} />
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
}

/**
 * Choix du thème, en deux familles (comme MyFinances) : les identités (chacune sa forme, sa
 * typographie, sa matière) et les palettes de Lumen, le verre d'origine. Un tap l'applique.
 */
export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  const identities = THEMES.filter((th) => th.style !== 'lumen');
  const lumen = THEMES.filter((th) => th.style === 'lumen');
  return (
    <View style={{ gap: space.md }}>
      <Text variant="label" tone="muted">
        Identités · chacune sa forme, sa typographie, sa matière
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {identities.map((th) => (
          <Tile key={th.id} id={th.id} selected={th.id === value} onChange={onChange} />
        ))}
      </View>
      <Text variant="label" tone="muted" style={{ marginTop: space.sm }}>
        Lumen · verre et lumière
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {lumen.map((th) => (
          <Tile key={th.id} id={th.id} selected={th.id === value} onChange={onChange} />
        ))}
      </View>
    </View>
  );
}
