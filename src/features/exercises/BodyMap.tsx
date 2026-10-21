import { useState } from 'react';
import { Platform, View } from 'react-native';
import type { BodyPart } from 'react-native-body-highlighter';
import { bodyBack } from 'react-native-body-highlighter/dist/assets/bodyBack';
import { bodyFront } from 'react-native-body-highlighter/dist/assets/bodyFront';
import Svg, { G, Path } from 'react-native-svg';

import { BODY_REGIONS, loadLevel, regionAt, type BodyView, type RegionId, type RegionLoad } from '@/domain/bodyMap';
import { Text } from '@/ui/components/primitives';
import { space, useTheme } from '@/ui/theme';

import { BODY_OUTLINE_BACK, BODY_OUTLINE_FRONT } from './bodyOutline';

/**
 * Anatomy drawing from react-native-body-highlighter (MIT): its path data and outline, rendered
 * here so that taps use the right event per platform (react-native-svg's touch props leak into
 * the DOM on the web and trigger React warnings; a plain click does not).
 */
function Figure({ view, scale, fill, border, onPress }: { view: BodyView; scale: number; fill: (slug: string) => string | null; border: string; onPress: (slug: string) => void }) {
  const t = useTheme();
  const parts: BodyPart[] = view === 'front' ? bodyFront : bodyBack;
  const base = t.mapIdle;
  return (
    <Svg viewBox={view === 'front' ? '0 0 724 1448' : '724 0 724 1448'} width={200 * scale} height={400 * scale}>
      <G strokeWidth={2} fill="none">
        <Path d={view === 'front' ? BODY_OUTLINE_FRONT : BODY_OUTLINE_BACK} stroke={border} vectorEffect="non-scaling-stroke" />
      </G>
      {parts.flatMap((part) => {
        const slug = part.slug ?? '';
        if (slug === 'hair') return [];
        const color = fill(slug) ?? base;
        const press = () => onPress(slug);
        // Web: a DOM click (onPress: null stops react-native-svg from overwriting it and from adding
        // responder props). Native: the regular press.
        const handlers: Record<string, unknown> = Platform.OS === 'web' ? { onClick: press, onPress: null } : { onPress: press };
        const paths = [...(part.path?.common ?? []), ...(part.path?.left ?? []), ...(part.path?.right ?? [])];
        return paths.map((d) => <Path key={d} d={d} fill={color} {...handlers} />);
      })}
    </Svg>
  );
}

/**
 * Front and back anatomy side by side, each region coloured by its weekly hard sets; the selected
 * region glows gold. Scales to the width it gets (phones: ~140 px per figure).
 */
export function BodyMap({ loads, selected, onSelect }: { loads: readonly RegionLoad[]; selected: RegionId | null; onSelect: (id: RegionId) => void }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const gap = space.md;
  // The drawing is 200 × 400 at scale 1; two figures side by side, capped for tablets.
  const scale = width === 0 ? 0 : Math.min(1.5, (width - gap) / 400);
  const colors = ['', `${t.accent}55`, `${t.accent}AA`, t.accent, t.gold];
  const levels = new Map(loads.map((l) => [l.region, loadLevel(l.perWeek)]));
  const border = t.mapRim;

  const fillFor = (view: BodyView) => (slug: string) => {
    const region = regionAt(view, slug);
    if (region === null) return null;
    const level = region.id === selected ? 4 : (levels.get(region.id) ?? 0);
    return level === 0 ? null : (colors[level] ?? null);
  };

  const figure = (view: BodyView) => (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Figure
        view={view}
        scale={scale}
        fill={fillFor(view)}
        border={border}
        onPress={(slug) => {
          const region = regionAt(view, slug);
          if (region !== null) onSelect(region.id);
        }}
      />
      <Text variant="caption" tone="muted">
        {view === 'front' ? 'Face' : 'Dos'}
      </Text>
    </View>
  );

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityLabel={`Carte musculaire : ${BODY_REGIONS.length} groupes, touche un muscle`}>
      {scale > 0 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap }}>
          {figure('front')}
          {figure('back')}
        </View>
      )}
    </View>
  );
}

/** Colour scale of the map. */
export function BodyLegend() {
  const t = useTheme();
  const items = [
    { color: t.mapZero, label: '0' },
    { color: `${t.accent}55`, label: '< 5' },
    { color: `${t.accent}AA`, label: '5-9' },
    { color: t.accent, label: '10 +' },
  ];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm }}>
      <Text variant="caption" tone="muted">
        Séries / sem.
      </Text>
      {items.map((i) => (
        <View key={i.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: i.color }} />
          <Text variant="caption" tone="secondary">
            {i.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
