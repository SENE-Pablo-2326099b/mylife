import paths from './bodyPaths.json';

/**
 * Le corps anatomique (face et dos), les tracés de l'ancienne app : react-native-body-highlighter (licence MIT, voir
 * LICENSE-react-native-body-highlighter.txt), rendus en SVG simple. Chaque muscle prend une intensité de 0 à 1 :
 * plein orange pour le muscle principal, plus clair pour les secondaires (couleurs du dégradé de MyPerf).
 */
type Side = 'front' | 'back';
const REGIONS: Record<Side, Record<string, string>> = {
  front: { chest: 'chest', deltoids: 'shoulders', biceps: 'biceps', triceps: 'triceps', forearm: 'forearms', abs: 'abs', obliques: 'abs', trapezius: 'traps', quadriceps: 'quads', adductors: 'adductors', calves: 'calves', tibialis: 'calves' },
  back: { deltoids: 'rear_delts', triceps: 'triceps', forearm: 'forearms', trapezius: 'traps', 'upper-back': 'back', 'lower-back': 'lower_back', gluteal: 'glutes', hamstring: 'hamstrings', adductors: 'adductors', calves: 'calves' },
};
/** Le grand dorsal se lit sur le haut du dos ; l'arrière d'épaule sur le deltoïde vu de dos. */
const ALIASES: Record<string, string[]> = { back: ['lats'], shoulders: [] };

const heat = (v: number) => {
  if (v <= 0) return 'rgba(255,255,255,.07)';
  const a = Math.min(1, v);
  return `rgba(${Math.round(255 - a * 15)},${Math.round(196 - a * 100)},${Math.round(150 - a * 122)},${(0.28 + a * 0.68).toFixed(2)})`;
};

export function Body({ values, label }: { values: Partial<Record<string, number>>; label: string }) {
  const value = (region: string) => Math.max(values[region] ?? 0, ...(ALIASES[region] ?? []).map((m) => values[m] ?? 0));
  const view = (side: Side) => (
    <svg viewBox={side === 'front' ? '0 0 724 1448' : '724 0 724 1448'} aria-hidden="true">
      {paths.skin[side].map((d, i) => (
        <path key={`s${i}`} d={d} fill="rgba(255,255,255,.045)" />
      ))}
      {paths[side].map((part) => {
        const region = REGIONS[side][part.slug];
        const fill = region ? heat(value(region)) : 'rgba(255,255,255,.045)';
        return part.d.map((d, i) => <path key={`${part.slug}${i}`} d={d} fill={fill} stroke="rgba(5,6,13,.9)" strokeWidth={1.5} />);
      })}
      <path d={paths.outline[side === 'front' ? 0 : 1]} fill="none" stroke="rgba(255,255,255,.32)" strokeWidth={2.5} />
    </svg>
  );
  return (
    <div className="pf-body" role="img" aria-label={label}>
      {view('front')}
      {view('back')}
    </div>
  );
}
