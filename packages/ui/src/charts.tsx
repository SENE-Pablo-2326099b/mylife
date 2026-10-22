import { m } from 'framer-motion';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { springs } from './motion';
import { Glass } from './primitives';
import type { Tone } from './theme';
import { useTheme } from './themeRuntime';

/**
 * Graphiques dessinés avec de la lumière : la série principale est un faisceau (or → accent) avec
 * un halo doux et un lavis dessous ; les autres séries restent en encre (secondaire, pointillés) ;
 * la grille est à peine gravée. Survol / glisser = réticule et valeurs exactes.
 * Les textes portent les jetons de texte, jamais la couleur d'une série.
 */

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Chemin lissé (Catmull-Rom → Bézier) pour que le faisceau se lise d'un seul geste. */
function smoothPath(pts: [number, number][]): string {
  let d = '';
  pts.forEach(([x, y], i) => {
    if (i === 0) {
      d = `M${x.toFixed(1)},${y.toFixed(1)}`;
      return;
    }
    const [x0, y0] = pts[i - 1] ?? [x, y];
    const [xm1, ym1] = pts[i - 2] ?? [x0, y0];
    const [x2, y2] = pts[i + 1] ?? [x, y];
    const c1x = x0 + (x - xm1) / 6;
    const c1y = y0 + (y - ym1) / 6;
    const c2x = x - (x2 - x0) / 6;
    const c2y = y - (y2 - y0) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return d;
}

/** Segments continus (une valeur nulle coupe la courbe). */
function segments(values: (number | null | undefined)[], sx: (i: number) => number, sy: (v: number) => number): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push([sx(i), sy(v)]);
  });
  if (cur.length) out.push(cur);
  return out;
}

export interface Series {
  id: string;
  label: string;
  values: (number | null | undefined)[];
  /** primary : faisceau lumineux ; secondary : encre ; dashed : référence en pointillés. */
  look: 'primary' | 'secondary' | 'dashed';
}

function niceRange(min: number, max: number, zero: boolean): [number, number] {
  let lo = zero ? Math.min(0, min) : min;
  let hi = max;
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  return [zero && lo === 0 ? 0 : lo - pad, hi + pad];
}

export function SeriesSwatch({ look }: { look: Series['look'] }) {
  const t = useTheme();
  const id = useId();
  return (
    <svg width="18" height="6" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={t.gold} />
          <stop offset="1" stopColor={t.accent} />
        </linearGradient>
      </defs>
      <line
        x1="1"
        y1="3"
        x2="17"
        y2="3"
        stroke={look === 'primary' ? `url(#${id})` : look === 'secondary' ? t.textSecondary : t.textMuted}
        strokeWidth={look === 'primary' ? 2.5 : 2}
        strokeDasharray={look === 'dashed' ? '3 2.5' : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LineChart({
  series,
  xLabels,
  formatY,
  height = 200,
  zero = true,
  ariaLabel,
  marker,
}: {
  series: Series[];
  /** Libellé de chaque point (tooltip, axe). */
  xLabels: string[];
  formatY: (v: number) => string;
  height?: number;
  /** L'axe vertical part de 0. */
  zero?: boolean;
  ariaLabel: string;
  /** Index d'un repère vertical (aujourd'hui). */
  marker?: number;
}) {
  const t = useTheme();
  const ids = { stroke: useId(), area: useId() };
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = xLabels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && v !== undefined));
  if (n === 0 || all.length === 0) return null;
  const [minY, maxY] = niceRange(Math.min(...all), Math.max(...all), zero);
  const padL = 4;
  // La colonne des valeurs à droite s'élargit selon la longueur des libellés.
  const gridLabels = [0, 0.5, 1].map((f) => formatY(minY + f * (maxY - minY)));
  const padR = Math.max(36, Math.max(...gridLabels.map((l) => l.length)) * 6.4 + 10);
  const padT = 10;
  const padB = 22;
  const plotW = Math.max(1, width - padL - padR);
  const sx = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const sy = (v: number) => padT + (1 - (v - minY) / (maxY - minY)) * (height - padT - padB);
  const grid = [0, 0.5, 1].map((f) => minY + f * (maxY - minY));
  const primary = series.find((s) => s.look === 'primary');

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    const i = Math.round(((x - padL) / plotW) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  };

  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));

  return (
    <div>
      {series.length >= 2 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Légende">
          {series.map((s) => (
            <li key={s.id} className="t-caption flex items-center gap-1.5 text-secondary">
              <SeriesSwatch look={s.look} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={ref}
        className="relative touch-pan-y select-none"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} className="absolute inset-0 overflow-visible">
            <defs>
              <linearGradient id={ids.stroke} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={t.gold} />
                <stop offset="1" stopColor={t.accent} />
              </linearGradient>
              <linearGradient id={ids.area} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={t.accent} stopOpacity={0.24} />
                <stop offset="1" stopColor={t.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            {grid.map((g) => (
              <g key={g}>
                <line x1={padL} x2={padL + plotW} y1={sy(g)} y2={sy(g)} stroke={t.border} strokeWidth={1} />
                <text x={width - 2} y={sy(g) + 4} textAnchor="end" fontSize={11} fill={t.textMuted} fontFamily="Inter, sans-serif">
                  {formatY(g)}
                </text>
              </g>
            ))}
            {xLabels.map((l, i) =>
              i % tickEvery === 0 || i === n - 1 ? (
                <text key={i} x={sx(i)} y={height - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill={t.textMuted} fontFamily="Inter, sans-serif">
                  {l}
                </text>
              ) : null,
            )}
            {marker !== undefined && marker >= 0 && marker < n && <line x1={sx(marker)} x2={sx(marker)} y1={padT} y2={height - padB} stroke={t.textMuted} strokeDasharray="2 3" strokeWidth={1} />}
            {primary &&
              segments(primary.values, sx, sy).map((seg, k) => {
                if (seg.length < 2) return null;
                const d = smoothPath(seg);
                const first = seg[0] as [number, number];
                const last = seg[seg.length - 1] as [number, number];
                const base = sy(zero ? Math.max(minY, Math.min(maxY, 0)) : minY);
                return <path key={`a${k}`} d={`${d} L${last[0].toFixed(1)},${base} L${first[0].toFixed(1)},${base} Z`} fill={`url(#${ids.area})`} />;
              })}
            {series
              .filter((s) => s.look !== 'primary')
              .map((s) =>
                segments(s.values, sx, sy).map((seg, k) => (
                  <path
                    key={`${s.id}${k}`}
                    d={smoothPath(seg)}
                    fill="none"
                    stroke={s.look === 'secondary' ? t.textSecondary : t.textMuted}
                    strokeWidth={s.look === 'secondary' ? 1.75 : 1.5}
                    strokeDasharray={s.look === 'dashed' ? '4 3' : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )),
              )}
            {primary &&
              segments(primary.values, sx, sy).map((seg, k) => {
                const d = smoothPath(seg);
                return (
                  <g key={`p${k}`}>
                    <path d={d} fill="none" stroke={`url(#${ids.stroke})`} strokeOpacity={0.25} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
                    <path d={d} fill="none" stroke={`url(#${ids.stroke})`} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                );
              })}
            {active !== null && (
              <>
                <line x1={sx(active)} x2={sx(active)} y1={padT} y2={height - padB} stroke={t.textMuted} strokeWidth={1} />
                {series.map((s) => {
                  const v = s.values[active];
                  if (v === null || v === undefined) return null;
                  return s.look === 'primary' ? (
                    <g key={s.id}>
                      <circle cx={sx(active)} cy={sy(v)} r={11} fill={t.accent} opacity={0.18} />
                      <circle cx={sx(active)} cy={sy(v)} r={5} fill={t.accent} stroke={t.bg} strokeWidth={2} />
                    </g>
                  ) : (
                    <circle key={s.id} cx={sx(active)} cy={sy(v)} r={4} fill={t.bg} stroke={s.look === 'secondary' ? t.textSecondary : t.textMuted} strokeWidth={2} />
                  );
                })}
              </>
            )}
          </svg>
        )}
        {active !== null && width > 0 && (
          <Glass level="raised" className="glass-solid pointer-events-none absolute top-0 z-10 rounded-sm px-3 py-2" style={{ left: Math.min(Math.max(0, sx(active) - 80), Math.max(0, width - 172)), width: 168 }}>
            <p className="t-caption text-muted">{xLabels[active]}</p>
            {series.map((s) => {
              const v = s.values[active];
              if (v === null || v === undefined) return null;
              return (
                <p key={s.id} className="t-small flex items-center gap-1.5">
                  <SeriesSwatch look={s.look} />
                  <span className="num font-display font-semibold">{formatY(v)}</span>
                  <span className="truncate text-muted">{s.label}</span>
                </p>
              );
            })}
          </Glass>
        )}
      </div>
    </div>
  );
}

export function Sparkline({ values, width = 84, height = 30, label }: { values: readonly number[]; width?: number; height?: number; label?: string }) {
  const t = useTheme();
  const id = useId();
  if (values.length < 2) return <span style={{ width, height }} className="inline-block" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts: [number, number][] = values.map((v, i) => [(i / (values.length - 1)) * (width - 8) + 4, 4 + (1 - (v - min) / span) * (height - 8)]);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const end = pts[pts.length - 1] as [number, number];
  const rising = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);
  return (
    <svg width={width} height={height} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={rising ? t.accent : t.textMuted} stopOpacity={rising ? 0.55 : 0.4} />
          <stop offset="1" stopColor={rising ? t.gold : t.warning} />
        </linearGradient>
      </defs>
      <path d={d} stroke={`url(#${id})`} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={end[0]} cy={end[1]} r={3.2} fill={rising ? t.gold : t.warning} />
    </svg>
  );
}

/**
 * Anneau de lumière : la rainure est du verre gravé, l'arc est allumé (dégradé + lueur).
 * `tone` porte le sens (succès = dans le budget, alerte = presque atteint, danger = dépassé).
 */
export function Ring({ value, size = 220, stroke = 14, tone = 'accent', children, label }: { value: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode; label: string }) {
  const t = useTheme();
  const id = useId();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const from = tone === 'accent' ? t.accentGradient[0] : tone === 'gold' ? t.goldGradient[0] : t[tone];
  const to = tone === 'accent' ? t.gold : tone === 'gold' ? t.goldGradient[1] : t[tone];
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90 overflow-visible">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={t.surfaceAlt} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={t.well} strokeWidth={stroke - 6} fill="none" />
        {v > 0 && (
          <>
            <m.circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={`url(#${id})`}
              strokeOpacity={0.3}
              strokeWidth={stroke + 8}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: c * (1 - v) }}
              transition={springs.soft}
              style={{ filter: 'blur(6px)' }}
            />
            <m.circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={`url(#${id})`}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: c * (1 - v) }}
              transition={springs.soft}
            />
          </>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">{children}</div>
    </div>
  );
}

/** Barre empilée (répartition) : segments séparés par 2 px de vide, légende avec valeurs en encre. */
export function AllocationBar({ items, format, label }: { items: { label: string; value: number; color: string }[]; format: (v: number) => string; label: string }) {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  if (total <= 0) return null;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-pill" role="img" aria-label={label}>
        {items
          .filter((i) => i.value > 0)
          .map((i) => (
            <m.span key={i.label} className="h-full first:rounded-l-pill last:rounded-r-pill" style={{ background: i.color }} initial={{ flexGrow: 0 }} animate={{ flexGrow: i.value }} transition={springs.soft} />
          ))}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 min-[400px]:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className="t-small flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: i.color }} />
            <span className="min-w-0 flex-1 truncate text-secondary">{i.label}</span>
            <span className="num font-display font-semibold">{format(i.value)}</span>
            <span className="num w-10 text-right text-muted">{Math.round((i.value * 100) / total)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Colonnes de lumière avec la valeur au sommet (ex. flux du mois, mois par mois). */
export function ColumnChart({ data, format, height = 150, label }: { data: { label: string; value: number; lit?: boolean; tone?: Tone }[]; format: (v: number) => string; height?: number; label: string }) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <div role="img" aria-label={label}>
      <div className="flex items-end gap-2 border-b" style={{ height, borderColor: 'var(--border)' }}>
        {data.map((d, i) => {
          const h = Math.max(4, (Math.abs(d.value) / max) * (height - 30));
          const tone = d.tone ?? 'accent';
          const fill = tone === 'accent' ? 'linear-gradient(180deg, var(--accent-g0), var(--gold-rim-strong))' : `linear-gradient(180deg, var(--${tone}), var(--${tone}-rim))`;
          return (
            <div key={`${d.label}${i}`} className="flex min-w-0 flex-1 flex-col items-center justify-end">
              <span className={`num mb-1 truncate font-display text-[11px] font-semibold ${d.lit === false ? 'text-secondary' : ''}`}>{format(d.value)}</span>
              <m.span
                className="w-[64%] max-w-[28px] rounded-t-[8px]"
                style={{ background: fill, opacity: d.lit === false ? 0.45 : 1, boxShadow: d.lit === false ? undefined : `0 0 18px var(--${tone}-halo)` }}
                initial={{ height: 0 }}
                animate={{ height: h }}
                transition={springs.soft}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {data.map((d, i) => (
          <span key={`${d.label}${i}`} className="t-caption min-w-0 flex-1 truncate text-center text-muted">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Colonnes empilées (une par période) : chaque couche a sa couleur, séparées par un filet de 2 px ;
 * une ligne de référence en pointillés en option. Survol / toucher = valeurs exactes de la colonne.
 */
export function StackedColumns({
  labels,
  layers,
  reference,
  formatY,
  height = 220,
  ariaLabel,
  legend = true,
}: {
  labels: string[];
  layers: { id: string; label: string; color: string; values: number[] }[];
  reference?: { label: string; value: number } | null;
  formatY: (v: number) => string;
  height?: number;
  ariaLabel: string;
  /** false : les couches sont déjà nommées à côté (chiffres clés avec leur pastille). */
  legend?: boolean;
}) {
  const t = useTheme();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = labels.length;
  if (n === 0) return null;
  const totals = labels.map((_, i) => layers.reduce((s, l) => s + Math.max(0, l.values[i] ?? 0), 0));
  const top = Math.max(1, ...totals, reference?.value ?? 0) * 1.06;
  const padT = 10;
  const padB = 22;
  const gridLabels = [0, 0.5, 1].map((f) => formatY(f * top));
  const padR = Math.max(36, Math.max(...gridLabels.map((l) => l.length)) * 6.4 + 10);
  const plotW = Math.max(1, width - padR);
  const plotH = height - padT - padB;
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(28, slot * 0.68));
  const sy = (v: number) => padT + (1 - v / top) * plotH;
  const cx = (i: number) => slot * i + slot / 2;
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 52))));
  const pick = (clientX: number, el: Element) => {
    const x = clientX - el.getBoundingClientRect().left;
    setActive(Math.max(0, Math.min(n - 1, Math.floor(x / slot))));
  };

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Légende">
        {legend &&
          layers.map((l) => (
            <li key={l.id} className="t-caption flex items-center gap-1.5 text-secondary">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        {reference && (
          <li className="t-caption flex items-center gap-1.5 text-secondary">
            <SeriesSwatch look="dashed" />
            {reference.label}
          </li>
        )}
      </ul>
      <div
        ref={ref}
        className="relative touch-pan-y select-none"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} className="absolute inset-0 overflow-visible">
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={0} x2={plotW} y1={sy(f * top)} y2={sy(f * top)} stroke={t.border} strokeWidth={1} />
                <text x={width - 2} y={sy(f * top) + 4} textAnchor="end" fontSize={11} fill={t.textMuted} fontFamily="Inter, sans-serif">
                  {formatY(f * top)}
                </text>
              </g>
            ))}
            {labels.map((_, i) => {
              let base = 0;
              const visible = layers.filter((l) => (l.values[i] ?? 0) > 0);
              return (
                <g key={i} opacity={active === null || active === i ? 1 : 0.55}>
                  {visible.map((l, k) => {
                    const v = l.values[i] ?? 0;
                    const y0 = sy(base);
                    base += v;
                    const y1 = sy(base);
                    // Filet de 2 px entre les couches ; extrémité haute arrondie (4 px) sur la dernière.
                    const gap = k > 0 ? 2 : 0;
                    const h = Math.max(0, y0 - y1 - gap);
                    const last = k === visible.length - 1;
                    const r = last ? Math.min(4, h / 2, barW / 2) : 0;
                    const x = cx(i) - barW / 2;
                    const y = y1;
                    return (
                      <path
                        key={l.id}
                        d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                        fill={l.color}
                      />
                    );
                  })}
                </g>
              );
            })}
            {reference && reference.value > 0 && reference.value <= top && (
              <line x1={0} x2={plotW} y1={sy(reference.value)} y2={sy(reference.value)} stroke={t.textMuted} strokeWidth={1.5} strokeDasharray="4 3" />
            )}
            {labels.map((l, i) =>
              i % tickEvery === 0 || i === n - 1 ? (
                <text key={i} x={cx(i)} y={height - 4} textAnchor="middle" fontSize={11} fill={t.textMuted} fontFamily="Inter, sans-serif">
                  {l}
                </text>
              ) : null,
            )}
          </svg>
        )}
        {active !== null && width > 0 && (
          <Glass level="raised" className="glass-solid pointer-events-none absolute top-0 z-10 rounded-sm px-3 py-2" style={{ left: Math.min(Math.max(0, cx(active) - 90), Math.max(0, width - 190)), width: 186 }}>
            <p className="t-caption text-muted">{labels[active]}</p>
            <p className="t-small num font-display font-semibold">{formatY(totals[active] ?? 0)}</p>
            {layers.map((l) => (
              <p key={l.id} className="t-small flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: l.color }} />
                <span className="num">{formatY(l.values[active] ?? 0)}</span>
                <span className="truncate text-muted">{l.label}</span>
              </p>
            ))}
          </Glass>
        )}
      </div>
    </div>
  );
}

/**
 * Calendrier du cycle : une case par jour, intensité de l'accent selon la dépense (une seule teinte,
 * du clair au soutenu), point d'alerte quand le jour a dépassé son budget, contour pointillé pour les
 * jours à venir, anneau pour aujourd'hui. Toucher un jour = son détail sous la grille.
 */
/** Formateur créé une fois : `toLocaleDateString` en recrée un à chaque appel (31 cases par rendu). */
const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function SpendCalendar({
  days,
  today,
  format,
  label,
}: {
  days: { date: string; spent: number; budget: number; future: boolean }[];
  today: string;
  format: (cents: number) => string;
  label: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  if (days.length === 0) return null;
  const max = Math.max(1, ...days.map((d) => d.spent));
  const first = new Date(`${days[0]!.date}T12:00:00Z`).getUTCDay();
  const lead = (first + 6) % 7;
  const pickedDay = days.find((d) => d.date === picked) ?? null;
  const fmtDay = (iso: string) => DAY_FORMAT.format(new Date(`${iso}T12:00:00Z`));
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5" role="grid" aria-label={label}>
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
          <span key={i} className="t-caption pb-0.5 text-center text-muted" aria-hidden>
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} aria-hidden />
        ))}
        {days.map((d) => {
          const level = d.spent > 0 ? Math.ceil((d.spent / max) * 4) : 0;
          const over = !d.future && d.spent > d.budget && d.budget >= 0 && d.spent > 0;
          const isToday = d.date === today;
          const day = Number(d.date.slice(8, 10));
          return (
            <button
              key={d.date}
              type="button"
              role="gridcell"
              aria-label={`${fmtDay(d.date)} : ${d.future ? 'à venir' : `${format(d.spent)} dépensés${over ? ', au-dessus du budget du jour' : ''}`}`}
              aria-pressed={picked === d.date}
              onClick={() => setPicked(picked === d.date ? null : d.date)}
              className={`relative flex aspect-square items-center justify-center rounded-[10px] text-[11px] font-semibold transition-transform active:scale-95 ${d.future ? 'border border-dashed border-line text-muted' : ''}`}
              style={
                d.future
                  ? undefined
                  : {
                      background: level === 0 ? 'var(--surface-alt)' : `color-mix(in srgb, var(--accent) ${[0, 22, 40, 62, 88][level]}%, transparent)`,
                      color: level >= 3 ? 'var(--on-accent)' : 'var(--text-secondary)',
                      boxShadow: `${isToday ? '0 0 0 2px var(--text), ' : ''}inset 0 1px 0 var(--glass-pane-spec)${picked === d.date ? ', 0 0 0 2px var(--accent-rim-strong)' : ''}`,
                    }
              }
            >
              {day}
              {over && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--warning)', boxShadow: '0 0 0 1.5px var(--bg)' }} />}
            </button>
          );
        })}
      </div>
      <div className="t-caption mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-muted">
        <span className="flex items-center gap-1.5">
          moins
          {[0, 22, 40, 62, 88].map((p) => (
            <span key={p} aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p ? `color-mix(in srgb, var(--accent) ${p}%, transparent)` : 'var(--surface-alt)' }} />
          ))}
          plus
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--warning)' }} />
          au-dessus du budget du jour
        </span>
      </div>
      {pickedDay && (
        <p className="t-small mt-2 text-secondary" aria-live="polite">
          <strong className="text-ink">{fmtDay(pickedDay.date)}</strong> ·{' '}
          {pickedDay.future ? 'à venir' : `${format(pickedDay.spent)} dépensés · budget du jour ${format(pickedDay.budget)}`}
        </p>
      )}
    </div>
  );
}
