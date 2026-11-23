import { regionAt, type BodyView, type RegionId } from '@mylife/training';
import paths from './bodyPaths.json';

/**
 * Le corps anatomique (face et dos), comme dans l'ancienne app : les tracés de react-native-body-highlighter (licence
 * MIT, voir LICENSE-react-native-body-highlighter.txt), les zones de `BODY_REGIONS` (packages/training). Chaque zone
 * prend une intensité de 0 à 1 (le volume) ; on touche une zone pour la choisir, elle ressort en blanc.
 */
const heat = (v: number) => {
  if (v <= 0) return 'rgba(255,255,255,.07)';
  const a = Math.min(1, v);
  return `rgba(${Math.round(255 - a * 15)},${Math.round(196 - a * 100)},${Math.round(150 - a * 122)},${(0.28 + a * 0.68).toFixed(2)})`;
};

export function Body({ values, selected = null, onSelect, label }: { values: Partial<Record<RegionId, number>>; selected?: RegionId | null; onSelect?: (id: RegionId) => void; label: string }) {
  const view = (side: BodyView) => (
    <svg viewBox={side === 'front' ? '0 0 724 1448' : '724 0 724 1448'} aria-hidden="true">
      {paths.skin[side].map((d, i) => (
        <path key={`s${i}`} d={d} fill="rgba(255,255,255,.045)" />
      ))}
      {paths[side].map((part) => {
        const region = regionAt(side, part.slug);
        const isSel = region !== null && region.id === selected;
        const fill = region ? heat(values[region.id] ?? 0) : 'rgba(255,255,255,.045)';
        return part.d.map((d, i) => (
          <path
            key={`${part.slug}${i}`}
            d={d}
            fill={fill}
            stroke={isSel ? '#ffffff' : 'rgba(5,6,13,.9)'}
            strokeWidth={isSel ? 7 : 1.5}
            className={region && onSelect ? 'pf-zone' : undefined}
            onClick={region && onSelect ? () => onSelect(region.id) : undefined}
          />
        ));
      })}
      <path d={paths.outline[side === 'front' ? 0 : 1]} fill="none" stroke="rgba(255,255,255,.32)" strokeWidth={2.5} pointerEvents="none" />
    </svg>
  );
  return (
    <div className="pf-body" role="img" aria-label={label}>
      {view('front')}
      {view('back')}
    </div>
  );
}
