import type { Status } from '../domain/budget';
import { IconCheck, IconWarn } from './icons';

const STATUS_LABEL: Record<Status, string> = { good: 'Dans le vert', warn: 'Attention', bad: 'Dépassé' };
const STATUS_COLOR: Record<Status, string> = { good: 'rgb(var(--good))', warn: 'rgb(var(--warn))', bad: 'rgb(var(--bad))' };

/** Jauge circulaire : part du budget du jour consommée. Le statut est aussi donné en texte et en icône. */
export function Gauge({ percent, status, children }: { percent: number; status: Status; children: React.ReactNode }) {
  const r = 88;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative mx-auto h-[220px] w-[220px]">
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" role="img" aria-label={`${STATUS_LABEL[status]} : ${percent} % du budget du jour utilisé`}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgb(var(--raised))" strokeWidth="14" />
        {p > 0 && (
          <circle cx="100" cy="100" r={r} fill="none" stroke={STATUS_COLOR[status]} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(c * p) / 100} ${c}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function StatusPill({ status }: { status: Status }) {
  const tone = { good: 'bg-good/15 text-good', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/15 text-bad' }[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {status === 'good' ? <IconCheck size={14} /> : <IconWarn size={14} />}
      {STATUS_LABEL[status]}
    </span>
  );
}
