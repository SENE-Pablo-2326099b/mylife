import { useId, useState, type PointerEvent, type ReactNode } from 'react';

/**
 * Les graphiques de MyFinances V5, en SVG pur : chaque écran a le sien (maquettes validées). Ils prennent des
 * nombres déjà calculés par le moteur et ne décident de rien. Chacun porte une description pour les lecteurs d'écran.
 */

const GRAD_A = '#7b5cff';
const GRAD_B = '#38c6f4';

/** L'anneau du jour : un arc de 270°, rempli à `fraction` (0 à 1). */
export function Ring({ fraction, label, tone = 'ok', children }: { fraction: number; label: string; tone?: 'ok' | 'warn'; children: ReactNode }) {
  const id = useId();
  const full = 2 * Math.PI * 112 * 0.75;
  const filled = Math.max(0, Math.min(1, fraction)) * full;
  return (
    <div className="fin-ring">
      <svg role="img" aria-label={label} viewBox="0 0 280 280">
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={tone === 'warn' ? '#ff9a62' : GRAD_A} />
            <stop offset="1" stopColor={tone === 'warn' ? '#fbbf24' : GRAD_B} />
          </linearGradient>
          <filter id={`${id}f`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <g transform="rotate(135 140 140)" fill="none" strokeLinecap="round">
          <circle cx="140" cy="140" r="112" stroke="var(--line)" strokeWidth="18" strokeDasharray={`${full} 704`} />
          {filled > 0.5 && (
            <>
              <circle cx="140" cy="140" r="112" stroke={`url(#${id}g)`} strokeWidth="18" strokeDasharray={`${filled} 704`} filter={`url(#${id}f)`} opacity="0.7" />
              <circle cx="140" cy="140" r="112" stroke={`url(#${id}g)`} strokeWidth="18" strokeDasharray={`${filled} 704`} />
            </>
          )}
        </g>
      </svg>
      <div className="fin-ring-in">{children}</div>
    </div>
  );
}

/**
 * Les dépenses cumulées du cycle : ce cycle (trait plein, jusqu'à aujourd'hui), le rythme idéal (pointillés, de zéro
 * au budget du cycle) et le cycle précédent (trait fin). Une seule échelle pour les trois.
 */
export function PaceChart({ current, previous, pot, length, label, format, labels }: { current: number[]; previous: number[]; pot: number; length: number; label: string; format: (cents: number) => string; labels: [string, string] }) {
  const id = useId();
  const top = Math.max(pot, ...current, ...previous, 1);
  const [X0, X1, Y0, Y1] = [54, 318, 128, 16];
  const x = (i: number) => X0 + (Math.min(i, length) / length) * (X1 - X0);
  const y = (v: number) => Y0 - (Math.max(0, v) / top) * (Y0 - Y1);
  const path = (values: number[]) => values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const day = current.length - 1;
  const line = path(current);
  const ticks = [top, top / 2, 0];
  return (
    <svg role="img" aria-label={label} viewBox="0 0 326 156" style={{ width: '100%', height: 'auto', maxHeight: 190 }}>
      <defs>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={GRAD_A} />
          <stop offset="1" stopColor={GRAD_B} />
        </linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={GRAD_B} stopOpacity="0.34" />
          <stop offset="1" stopColor={GRAD_B} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={X0} y1={y(t)} x2={X1} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
          <text x={X0 - 6} y={y(t) + 4} textAnchor="end" className="fin-axis">{format(t)}</text>
        </g>
      ))}
      {previous.length > 1 && <path d={path(previous)} fill="none" stroke="var(--ink-2)" strokeOpacity="0.6" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />}
      {pot > 0 && <line x1={x(0)} y1={y(0)} x2={x(length)} y2={y(pot)} stroke="var(--warn)" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" />}
      <path d={`${line} L${x(day).toFixed(1)} ${Y0} L${X0} ${Y0} Z`} fill={`url(#${id}f)`} />
      <path d={line} fill="none" stroke={`url(#${id}l)`} strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={x(day)} y1={Y1 - 4} x2={x(day)} y2={Y0} stroke="var(--ink-2)" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 4" />
      <circle cx={x(day)} cy={y(current[day] ?? 0)} r="6" fill="var(--ink)" />
      <text x={X0} y="150" className="fin-axis">{labels[0]}</text>
      {day > 3 && day < length - 3 && <text x={x(day)} y="150" textAnchor="middle" className="fin-axis" style={{ fill: 'var(--ink)' }}>auj.</text>}
      <text x={X1} y="150" textAnchor="end" className="fin-axis">{labels[1]}</text>
    </svg>
  );
}

/** Les derniers jours en barres, face au budget du jour (pointillés). Au-dessus : orange. Aujourd'hui : en clair. */
export function DayBars({ days, budget, label }: { days: { key: string; name: string; value: number; today: boolean }[]; budget: number; label: string }) {
  const id = useId();
  const max = Math.max(budget * 1.25, ...days.map((d) => d.value), 1);
  const H = 96;
  const y = (v: number) => 12 + H - (Math.max(0, v) / max) * H;
  const step = 320 / days.length;
  const top = days.reduce((a, b) => (b.value > a.value ? b : a), days[0]!);
  return (
    <svg role="img" aria-label={label} viewBox="0 0 320 132" style={{ width: '100%', height: 132 }}>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={GRAD_A} />
          <stop offset="1" stopColor={GRAD_B} />
        </linearGradient>
      </defs>
      {budget > 0 && <line x1="0" y1={y(budget)} x2="320" y2={y(budget)} stroke="var(--ink-2)" strokeWidth="1.5" strokeDasharray="3 6" />}
      {days.map((d, i) => {
        const h = Math.max(d.value > 0 ? 4 : 0, 12 + H - y(d.value));
        const x = i * step + (step - 28) / 2;
        return (
          <g key={d.key}>
            {h > 0 && <rect x={x} y={12 + H - h} width="28" height={h} rx={Math.min(8, h / 2)} fill={d.today ? 'var(--ink)' : d.value > budget && budget > 0 ? '#ff9a62' : `url(#${id}b)`} />}
            <text x={x + 14} y="126" textAnchor="middle" className="fin-axis" style={d.today ? { fill: 'var(--ink)' } : undefined}>
              {d.name}
            </text>
          </g>
        );
      })}
      {top && top.value > budget && budget > 0 && (
        <text x={days.indexOf(top) * step + step / 2} y={Math.max(10, y(top.value) - 5)} textAnchor="middle" className="fin-axis" style={{ fill: '#ff9a62', fontWeight: 700 }}>
          {Math.round(top.value / 100)} €
        </text>
      )}
    </svg>
  );
}

/** Le cycle jour par jour : une barre fine par jour, la sélection en clair. Toucher un jour le choisit. */
export function Histogram({ days, selected, onSelect, label }: { days: { date: string; value: number }[]; selected: string | null; onSelect: (date: string | null) => void; label: string }) {
  const id = useId();
  const max = Math.max(...days.map((d) => d.value), 1);
  const step = 354 / Math.max(days.length, 1);
  const w = Math.max(3, Math.min(14, step - 4));
  return (
    <svg role="img" aria-label={label} viewBox="0 0 354 76" style={{ width: '100%', height: 76 }}>
      <defs>
        <linearGradient id={`${id}h`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={GRAD_A} stopOpacity="0.6" />
          <stop offset="1" stopColor={GRAD_B} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {days.map((d, i) => {
        const h = d.value > 0 ? Math.max(4, (d.value / max) * 62) : 2;
        return (
          <g key={d.date} onClick={() => onSelect(selected === d.date ? null : d.date)} style={{ cursor: 'pointer' }}>
            <rect x={i * step} y="0" width={step} height="76" fill="transparent" />
            <rect x={i * step + (step - w) / 2} y={70 - h} width={w} height={h} rx={Math.min(4, w / 2)} fill={selected === d.date ? 'var(--ink)' : d.value > 0 ? `url(#${id}h)` : 'var(--line)'} />
          </g>
        );
      })}
    </svg>
  );
}

/** L'anneau par catégorie, le total au centre. */
export function Donut({ slices, label, children }: { slices: { key: string; color: string; amount: number }[]; label: string; children: ReactNode }) {
  const total = slices.reduce((s, x) => s + x.amount, 0);
  const C = 2 * Math.PI * 70;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: 168, height: 168, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg role="img" aria-label={label} viewBox="0 0 180 180" style={{ position: 'absolute', inset: 0, width: 168, height: 168 }}>
        <g transform="rotate(-90 90 90)" fill="none" strokeWidth="22">
          {total === 0 && <circle cx="90" cy="90" r="70" stroke="var(--line)" />}
          {slices.map((s) => {
            const len = (s.amount / total) * C;
            const at = offset;
            offset += len;
            return <circle key={s.key} cx="90" cy="90" r="70" stroke={s.color} strokeDasharray={`${Math.max(0, len - (slices.length > 1 ? 3 : 0))} ${C}`} strokeDashoffset={-at} />;
          })}
        </g>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>{children}</div>
    </div>
  );
}

/** Revenus et dépenses, cycle après cycle : deux barres par cycle. Le cycle en cours est estompé côté revenus s'ils ne sont pas tous arrivés. */
export function CashflowBars({ items, label }: { items: { key: string; name: string; income: number; expense: number; current: boolean }[]; label: string }) {
  const id = useId();
  const max = Math.max(...items.flatMap((x) => [x.income, x.expense]), 1);
  const step = 320 / Math.max(items.length, 1);
  const h = (v: number) => Math.max(v > 0 ? 3 : 0, (v / max) * 100);
  return (
    <svg role="img" aria-label={label} viewBox="0 0 320 140" style={{ width: '100%', height: 140 }}>
      <defs>
        <linearGradient id={`${id}d`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={GRAD_A} />
          <stop offset="1" stopColor="#a58bff" />
        </linearGradient>
      </defs>
      {items.map((x, i) => {
        const cx = i * step + step / 2;
        return (
          <g key={x.key}>
            <rect x={cx - 18} y={118 - h(x.income)} width="16" height={h(x.income)} rx="5" fill="#5ccbe6" />
            <rect x={cx + 2} y={118 - h(x.expense)} width="16" height={h(x.expense)} rx="5" fill={`url(#${id}d)`} />
            <text x={cx} y="134" textAnchor="middle" className="fin-axis" style={x.current ? { fill: 'var(--ink)' } : undefined}>
              {x.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Où vont les revenus du cycle : un flux qui se partage entre charges, épargne et reste à vivre. */
export function FlowChart({ revenus, charges, epargne, reste, format }: { revenus: number; charges: number; epargne: number; reste: number; format: (cents: number) => string }) {
  const id = useId();
  const parts = [
    { key: 'charges', name: 'Charges', value: Math.max(0, charges), color: '#f472b6', opacity: 0.4 },
    { key: 'epargne', name: 'Épargne', value: Math.max(0, epargne), color: '#6fe0a0', opacity: 0.45 },
    { key: 'reste', name: 'Reste à vivre', value: Math.max(0, reste), color: `url(#${id}r)`, opacity: 1 },
  ].filter((p) => p.value > 0);
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const H = 150;
  const gap = 8;
  let left = 10;
  let right = 2;
  const scale = (H - gap * (parts.length - 1) * 0) / total;
  return (
    <svg role="img" aria-label={`Où vont tes revenus du cycle : ${format(revenus)}, dont ${parts.map((p) => `${p.name.toLowerCase()} ${format(p.value)}`).join(', ')}`} viewBox="0 0 354 176" style={{ width: '100%', height: 176 }}>
      <defs>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={GRAD_B} stopOpacity="0.55" />
          <stop offset="1" stopColor={GRAD_A} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      {parts.map((p) => {
        const h = p.value * scale;
        const rh = Math.max(4, h - gap * (parts.length - 1) / parts.length);
        const [l0, r0] = [left, right];
        left += h;
        right += rh + gap;
        const big = p.key === 'reste';
        return (
          <g key={p.key}>
            <path d={`M14 ${l0} C177 ${l0} 177 ${r0} 340 ${r0} L340 ${r0 + rh} C177 ${r0 + rh} 177 ${l0 + h} 14 ${l0 + h} Z`} fill={p.color} opacity={p.opacity} />
            <rect x="340" y={r0} width="14" height={rh} rx="5" fill={p.key === 'reste' ? '#a58bff' : p.color} />
            {rh >= 16 && (
              <text x="328" y={r0 + rh / 2 + (big ? 8 : 4)} textAnchor="end" style={{ font: big ? '800 20px var(--font-display)' : '600 13px var(--font-text)', fill: 'var(--ink)' }}>
                {big ? format(p.value) : `${p.name}  ${format(p.value)}`}
              </text>
            )}
            {big && rh >= 44 && (
              <text x="328" y={r0 + rh / 2 - 14} textAnchor="end" style={{ font: '600 12px var(--font-text)', fill: 'var(--ink-2)' }}>
                Reste à vivre
              </text>
            )}
          </g>
        );
      })}
      <rect x="0" y="10" width="14" height={H} rx="5" fill="#5ccbe6" />
      <text x="26" y="44" style={{ font: '600 12px var(--font-text)', fill: 'var(--ink-2)' }}>Revenus</text>
      <text x="26" y="66" style={{ font: '800 20px var(--font-display)', fill: 'var(--ink)' }}>{format(revenus)}</text>
    </svg>
  );
}

/** Le solde jusqu'à la paie : une courbe en marches, le point bas marqué, la ligne du zéro en pointillés. */
export function ForecastChart({ points, low, format, labels }: { points: { date: string; balance: number }[]; low: { date: string; balance: number }; format: (cents: number) => string; labels: [string, string] }) {
  const id = useId();
  if (points.length < 2) return null;
  const values = points.map((p) => p.balance);
  const [min, max] = [Math.min(0, ...values), Math.max(...values, 1)];
  const x = (i: number) => 6 + (i / (points.length - 1)) * 308;
  const y = (v: number) => 14 + (1 - (v - min) / (max - min || 1)) * 104;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.balance).toFixed(1)}`).join(' ');
  const lowIndex = points.findIndex((p) => p.date === low.date);
  const negative = low.balance < 0;
  return (
    <svg role="img" aria-label={`Solde prévu jusqu'à la paie : de ${format(points[0]!.balance)} aujourd'hui à un point bas de ${format(low.balance)}`} viewBox="0 0 320 150" style={{ width: '100%', height: 150 }}>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={GRAD_B} stopOpacity="0.35" />
          <stop offset="1" stopColor={GRAD_B} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={y(0)} x2="320" y2={y(0)} stroke="var(--ink-2)" strokeWidth="1" strokeDasharray="3 6" opacity="0.6" />
      <path d={`${line} L${x(points.length - 1)} ${y(min)} L${x(0)} ${y(min)} Z`} fill={`url(#${id}a)`} />
      <path d={line} fill="none" stroke="#5ccbe6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(0)} cy={y(points[0]!.balance)} r="5" fill="var(--ink)" />
      <circle cx={x(lowIndex)} cy={y(low.balance)} r="5" fill={negative ? '#ffb8b8' : '#ffe0a3'} />
      <text x={Math.min(250, x(0) + 10)} y={Math.max(11, y(points[0]!.balance) - 9)} className="fin-axis" style={{ fill: 'var(--ink)' }}>
        {format(points[0]!.balance)}
      </text>
      <text x={Math.max(70, Math.min(314, x(lowIndex) - 8))} y={Math.max(11, y(low.balance) - 9)} textAnchor="end" className="fin-axis" style={{ fill: negative ? 'var(--bad)' : 'var(--warn)' }}>
        point bas {format(low.balance)}
      </text>
      <text x="6" y="144" className="fin-axis">{labels[0]}</text>
      <text x="314" y="144" textAnchor="end" className="fin-axis">{labels[1]}</text>
    </svg>
  );
}

/** Un petit anneau de budget : la part consommée, en pourcentage au centre. */
export function MiniRing({ fraction, color, label, size = 72 }: { fraction: number; color: string; label: string; size?: number }) {
  const C = 2 * Math.PI * 26;
  const over = fraction > 1;
  return (
    <svg role="img" aria-label={label} viewBox="0 0 72 72" style={{ width: size, height: size, flex: 'none' }}>
      <g transform="rotate(-90 36 36)" fill="none" strokeWidth="8" strokeLinecap="round">
        <circle cx="36" cy="36" r="26" stroke="var(--line)" />
        {fraction > 0 && <circle cx="36" cy="36" r="26" stroke={over ? '#ff9a62' : color} strokeDasharray={`${Math.min(1, fraction) * C} ${C}`} />}
      </g>
      <text x="36" y="41" textAnchor="middle" style={{ font: '800 15px var(--font-display)', fill: over ? '#ff9a62' : 'var(--ink)' }}>
        {Math.round(fraction * 100)} %
      </text>
    </svg>
  );
}

/**
 * L'évolution du patrimoine : une courbe à l'échelle du temps, avec ses montants (trois repères) et ses dates. Un
 * doigt ou la souris sur la courbe lit la valeur d'un jour ; sans geste, c'est celle d'aujourd'hui.
 */
export function WorthChart({ points, label, format, dayLabel, tickLabel }: { points: { date: string; value: number }[]; label: string; format: (cents: number) => string; dayLabel: (date: string) => string; tickLabel: (date: string) => string }) {
  const id = useId();
  const [picked, setPicked] = useState<number | null>(null);
  if (points.length < 2) return null;
  const time = (d: string) => Date.parse(`${d}T12:00:00Z`);
  const [t0, t1] = [time(points[0]!.date), time(points[points.length - 1]!.date)];
  const values = points.map((p) => p.value);
  const [min, max] = [Math.min(...values), Math.max(...values)];
  const pad = (max - min) * 0.12 || Math.max(1, Math.abs(max) * 0.05);
  const [lo, hi] = [min - pad, max + pad];
  const [X0, X1, Y0, Y1] = [50, 346, 150, 30];
  const x = (d: string) => X0 + ((time(d) - t0) / (t1 - t0 || 1)) * (X1 - X0);
  const y = (v: number) => Y0 - ((v - lo) / (hi - lo || 1)) * (Y0 - Y1);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - box.left) / box.width) * 354;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - at) < Math.abs(x(points[best]!.date) - at)) best = i;
    });
    setPicked(best);
  };
  const shown = picked !== null && picked < points.length ? points[picked]! : null;
  const ticks = [hi - pad, (lo + hi) / 2, lo + pad];
  const dates = [0, 0.5, 1].map((f) => new Date(t0 + f * (t1 - t0)).toISOString().slice(0, 10));
  const text = shown ? `${dayLabel(shown.date)} · ${format(shown.value)}` : '';
  const w = Math.max(96, text.length * 6.6 + 18);
  return (
    <svg role="img" aria-label={label} viewBox="0 0 354 178" style={{ width: '100%', height: 'auto', touchAction: 'pan-y', cursor: 'crosshair' }} onPointerDown={pick} onPointerMove={pick} onPointerLeave={() => setPicked(null)}>
      <defs>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6fe0a0" />
          <stop offset="1" stopColor={GRAD_B} />
        </linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fe0a0" stopOpacity="0.36" />
          <stop offset="1" stopColor="#6fe0a0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={X0} y1={y(t)} x2={X1 + 4} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
          <text x={X0 - 6} y={y(t) + 4} textAnchor="end" className="fin-axis">{format(t)}</text>
        </g>
      ))}
      <path d={`${line} L${X1} ${Y0} L${X0} ${Y0} Z`} fill={`url(#${id}f)`} />
      <path d={line} fill="none" stroke={`url(#${id}l)`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {dates.map((d, i) => (
        <text key={i} x={i === 0 ? X0 : i === 1 ? (X0 + X1) / 2 : X1} y="172" textAnchor={i === 0 ? 'start' : i === 1 ? 'middle' : 'end'} className="fin-axis">{tickLabel(d)}</text>
      ))}
      {shown ? (
        <>
          <line x1={x(shown.date)} y1="22" x2={x(shown.date)} y2={Y0} stroke="var(--ink-2)" strokeWidth="1" strokeDasharray="2 4" />
          <circle cx={x(shown.date)} cy={y(shown.value)} r="6" fill="var(--bg)" stroke="var(--ink)" strokeWidth="2.5" />
          <rect x={Math.max(2, Math.min(352 - w, x(shown.date) - w / 2))} y="0" width={w} height="24" rx="9" fill="var(--ink)" />
          <text x={Math.max(2, Math.min(352 - w, x(shown.date) - w / 2)) + w / 2} y="16.5" textAnchor="middle" style={{ font: '700 12px var(--font-text)', fill: 'var(--on-ink)' }}>{text}</text>
        </>
      ) : (
        <circle cx={X1} cy={y(values[values.length - 1]!)} r="5.5" fill="var(--ink)" />
      )}
    </svg>
  );
}

/** La projection : aujourd'hui, puis un cône qui s'élargit jusqu'à 10 ans, avec trois jalons. */
export function ConeChart({ now, marks, low, high, format }: { now: number; marks: { years: number; value: number }[]; low: number; high: number; format: (cents: number) => string }) {
  const top = Math.max(high, now, 1);
  const bottom = Math.min(now, low);
  const x = (years: number) => 40 + (years / 10) * 272;
  const y = (v: number) => 20 + (1 - (v - bottom) / (top - bottom || 1)) * 116;
  const last = marks[marks.length - 1]!;
  return (
    <svg role="img" aria-label={`Projection du patrimoine : ${marks.map((m) => `${format(m.value)} dans ${m.years} an${m.years > 1 ? 's' : ''}`).join(', ')}`} viewBox="0 0 320 170" style={{ width: '100%', height: 170 }}>
      <path d={`M${x(0)} ${y(now)} L${x(10)} ${y(high)} L${x(10)} ${y(low)} Z`} fill={GRAD_A} opacity="0.26" />
      <path d={`M2 ${Math.min(150, y(now) + 12)} L${x(0)} ${y(now)}`} fill="none" stroke="#6fe0a0" strokeWidth="3" strokeLinecap="round" />
      <path d={`M${x(0)} ${y(now)} ${marks.map((m) => `L${x(m.years)} ${y(m.value)}`).join(' ')}`} fill="none" stroke="#cdbeff" strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" />
      <circle cx={x(0)} cy={y(now)} r="5" fill="var(--ink)" />
      {marks.map((m) => (
        <g key={m.years}>
          <circle cx={x(m.years)} cy={y(m.value)} r={m === last ? 5 : 4} fill="#cdbeff" />
          <text x={x(m.years)} y={y(m.value) - 10} textAnchor={m === last ? 'end' : 'middle'} style={{ font: `800 ${m === last ? 17 : 13}px var(--font-display)`, fill: 'var(--ink)' }}>
            {format(m.value)}
          </text>
          <text x={x(m.years)} y="162" textAnchor={m === last ? 'end' : 'middle'} className="fin-axis">
            {m.years} an{m.years > 1 ? 's' : ''}
          </text>
        </g>
      ))}
      <text x={x(0) - 8} y="162" textAnchor="end" className="fin-axis">auj.</text>
    </svg>
  );
}

/** Des barres de mois, la dernière en clair (l'historique d'un marchand). */
export function MonthBars({ months, label }: { months: { key: string; name: string; value: number }[]; label: string }) {
  const id = useId();
  const max = Math.max(...months.map((m) => m.value), 1);
  const step = 320 / Math.max(months.length, 1);
  return (
    <svg role="img" aria-label={label} viewBox="0 0 320 64" style={{ width: '100%', height: 64 }}>
      <defs>
        <linearGradient id={`${id}m`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={GRAD_A} />
          <stop offset="1" stopColor={GRAD_B} />
        </linearGradient>
      </defs>
      {months.map((m, i) => {
        const h = m.value > 0 ? Math.max(4, (m.value / max) * 40) : 2;
        return (
          <g key={m.key}>
            <rect x={i * step + 8} y={46 - h} width={step - 16} height={h} rx={Math.min(7, h / 2)} fill={m.value === 0 ? 'var(--line)' : i === months.length - 1 ? 'var(--ink)' : `url(#${id}m)`} />
            <text x={i * step + step / 2} y="60" textAnchor="middle" className="fin-axis" style={i === months.length - 1 ? { fill: 'var(--ink)' } : undefined}>
              {m.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
