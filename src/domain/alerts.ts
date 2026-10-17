import type { Settings, Transaction } from '../db/types';
import { addDays, cycleFor, formatShort, type ISODate } from '../lib/dates';
import { formatCents } from '../lib/money';
import { normalizeText } from '../lib/text';
import { dailySeries, overrunStreaks, spent, isSpending, type CatMap } from './budget';
import { CAT, computeEnvelope } from './defaults';

export type AlertLevel = 'info' | 'warn' | 'bad';

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  /** Lien vers les opérations concernées. */
  link?: string;
}

export interface AlertInput {
  /** Opérations des 13 derniers mois au moins. */
  txs: Transaction[];
  cats: CatMap;
  settings: Settings;
  today: ISODate;
}

const LEVEL_ORDER: Record<AlertLevel, number> = { bad: 0, warn: 1, info: 2 };
const AMAZON = /\b(amazon|amzn)/;

export function computeAlerts({ txs, cats, settings, today }: AlertInput): Alert[] {
  const cfg = settings.alerts;
  const cycle = cycleFor(today, settings.payday);
  const inCycle = txs.filter((t) => t.date >= cycle.start && t.date <= today);
  const alerts: Alert[] = [];

  // 1. Livraisons
  if (cfg.deliveries.enabled) {
    const deliveries = inCycle.filter((t) => t.categoryId === CAT.livraison && t.amount < 0);
    const total = -deliveries.reduce((s, t) => s + t.amount, 0);
    const n = deliveries.length;
    if (n > cfg.deliveries.maxCount) {
      alerts.push({
        id: 'deliveries',
        level: 'bad',
        title: `${n} livraisons ce cycle (limite ${cfg.deliveries.maxCount})`,
        detail: `${formatCents(total)} en Deliveroo / Uber Eats depuis le ${formatShort(cycle.start)}, soit ${formatCents(Math.round(total / n))} par commande.`,
        link: `/transactions?cat=${CAT.livraison}`,
      });
    } else if (n === cfg.deliveries.maxCount && n > 0) {
      alerts.push({
        id: 'deliveries',
        level: 'info',
        title: `${n} livraisons ce cycle : tu es à la limite`,
        detail: `La prochaine commande dépassera ta limite de ${cfg.deliveries.maxCount}.`,
        link: `/transactions?cat=${CAT.livraison}`,
      });
    }
  }

  // 2. Amazon hors budget : achat Amazon alors que l'objectif Shopping est dépassé (ou qu'il n'y en a pas)
  if (cfg.amazon.enabled) {
    const shopping = cats.get(CAT.shopping);
    const target = shopping?.target ?? null;
    const shoppingTxs = inCycle.filter((t) => t.categoryId === CAT.shopping).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    let cumulative = 0;
    const offenders: Transaction[] = [];
    for (const t of shoppingTxs) {
      cumulative -= t.amount;
      const isAmazon = AMAZON.test(normalizeText(`${t.label} ${t.rawText}`));
      if (isAmazon && t.amount < 0 && -t.amount >= cfg.amazon.minAmount && (target === null || cumulative > target)) offenders.push(t);
    }
    if (offenders.length) {
      const sum = -offenders.reduce((s, t) => s + t.amount, 0);
      alerts.push({
        id: 'amazon',
        level: 'warn',
        title: `Amazon hors budget : ${offenders.length} achat${offenders.length > 1 ? 's' : ''} (${formatCents(sum)})`,
        detail:
          target === null
            ? 'Aucun objectif Shopping n’est défini pour ce cycle : chaque achat Amazon est imprévu.'
            : `Ton objectif Shopping (${formatCents(target)}) était déjà dépassé au moment de ${offenders.length > 1 ? 'ces achats' : 'cet achat'} : ${offenders.map((t) => `${formatShort(t.date)} ${formatCents(-t.amount)}`).join(', ')}.`,
        link: `/transactions?cat=${CAT.shopping}&q=amazon`,
      });
    }
  }

  // 3. Dépassement du budget quotidien plusieurs jours de suite
  if (cfg.dailyOverrun.enabled && cfg.dailyOverrun.days > 0) {
    const series = dailySeries(txs, cats, cycle, computeEnvelope(settings), today);
    const { current, longest, longestEnd } = overrunStreaks(series);
    if (current >= cfg.dailyOverrun.days) {
      alerts.push({
        id: 'overrun',
        level: 'bad',
        title: `Budget du jour dépassé ${current} jours de suite`,
        detail: 'Chaque dépassement réduit le budget des jours suivants. Une journée sans dépense remettrait les compteurs d’aplomb.',
        link: '/cycle',
      });
    } else if (longest >= cfg.dailyOverrun.days && longestEnd) {
      alerts.push({
        id: 'overrun',
        level: 'warn',
        title: `Budget du jour dépassé ${longest} jours de suite ce cycle`,
        detail: `Série terminée le ${formatShort(longestEnd)}.`,
        link: '/cycle',
      });
    }
  }

  // 4. Tickets de bus vs pass annuel (12 mois glissants)
  if (cfg.transportPass.enabled && cfg.transportPass.keyword.trim()) {
    const kw = normalizeText(cfg.transportPass.keyword);
    const from = addDays(today, -364);
    const tickets = txs.filter((t) => t.date >= from && t.date <= today && t.amount < 0 && normalizeText(`${t.label} ${t.rawText}`).includes(kw));
    const total = -tickets.reduce((s, t) => s + t.amount, 0);
    const price = cfg.transportPass.passPrice;
    if (total > price) {
      alerts.push({
        id: 'transport',
        level: 'warn',
        title: `Tickets de bus : ${formatCents(total)} sur 12 mois`,
        detail: `C’est plus que le pass annuel (${formatCents(price)}). Le pass t’aurait fait économiser ${formatCents(total - price)} : pense à le prendre.`,
        link: `/transactions?cat=${CAT.transport}&periode=all`,
      });
    } else if (price > 0 && total * 100 >= price * 80) {
      alerts.push({
        id: 'transport',
        level: 'info',
        title: `Tickets de bus : ${formatCents(total)} sur 12 mois`,
        detail: `Tu approches du prix du pass annuel (${formatCents(price)}).`,
        link: `/transactions?cat=${CAT.transport}&periode=all`,
      });
    }
  }

  // 5. Catégories au-dessus de leur objectif
  if (cfg.categoryTarget.enabled) {
    for (const c of cats.values()) {
      if (c.target === null || c.target <= 0 || (c.kind !== 'variable' && c.kind !== 'fixed')) continue;
      const s = spent(
        inCycle.filter((t) => t.categoryId === c.id),
        cats,
        isSpending,
      );
      if (s > c.target) {
        alerts.push({
          id: `target-${c.id}`,
          level: 'bad',
          title: `${c.emoji} ${c.name} : objectif dépassé`,
          detail: `${formatCents(s)} dépensés pour un objectif de ${formatCents(c.target)} (+${formatCents(s - c.target)}).`,
          link: `/transactions?cat=${c.id}`,
        });
      } else if (s * 100 >= c.target * cfg.categoryTarget.warnPercent) {
        alerts.push({
          id: `target-${c.id}`,
          level: 'warn',
          title: `${c.emoji} ${c.name} : ${Math.round((s * 100) / c.target)} % de l’objectif`,
          detail: `${formatCents(s)} sur ${formatCents(c.target)}, il reste ${formatCents(c.target - s)} jusqu’au ${formatShort(cycle.end)}.`,
          link: `/transactions?cat=${c.id}`,
        });
      }
    }
  }

  return alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
