import type { BudgetLine, Settings } from '../db/types';
import { isThemeId } from '../ui/themes';
import { DEFAULT_ALERTS, DEFAULT_FIRE, DEFAULT_SETTINGS } from './defaults';

/** Anciens réglages (v1, mono-utilisateur) encore présents dans une base ou une sauvegarde. */
interface LegacySettings {
  salary?: number;
  apl?: number;
  activityBonus?: number;
  investment?: number;
  ownerName?: string;
}

const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback);

function lines(v: unknown): BudgetLine[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l, i) => ({
      id: typeof l.id === 'string' ? l.id : `line-${i}`,
      label: typeof l.label === 'string' ? l.label : 'Sans nom',
      amount: Math.abs(int(l.amount, 0)),
      day: typeof l.day === 'number' && l.day >= 1 && l.day <= 31 ? Math.round(l.day) : null,
    }));
}

/**
 * Réglages complets et valides à partir de n'importe quelle version stockée.
 * Les réglages v1 (salaire, APL, prime, charges fixes et investissement en un seul montant, un seul nom)
 * deviennent des listes : rien n'est perdu, tout devient modifiable ligne par ligne.
 */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Omit<Partial<Settings>, 'fixedCharges'> & LegacySettings & { fixedCharges?: unknown };
  const legacy = r.incomes === undefined && (r.salary !== undefined || r.ownerName !== undefined);
  const payday = Math.min(31, Math.max(1, int(r.payday, DEFAULT_SETTINGS.payday)));

  let incomes = lines(r.incomes);
  if (!incomes) {
    incomes = [];
    if (r.salary) incomes.push({ id: 'income-salary', label: 'Salaire', amount: int(r.salary, 0), day: payday });
    if (r.apl) incomes.push({ id: 'income-apl', label: 'APL', amount: int(r.apl, 0), day: 5 });
    if (r.activityBonus) incomes.push({ id: 'income-bonus', label: 'Prime d’activité', amount: int(r.activityBonus, 0), day: 5 });
  }
  let fixedCharges = lines(r.fixedCharges);
  if (!fixedCharges) {
    fixedCharges = typeof r.fixedCharges === 'number' && r.fixedCharges > 0 ? [{ id: 'fixed-all', label: 'Charges fixes', amount: int(r.fixedCharges, 0), day: null }] : [];
  }
  const savings: Settings['savings'] =
    r.savings && typeof r.savings === 'object' && (r.savings.mode === 'auto' || r.savings.mode === 'manual')
      ? { mode: r.savings.mode, manual: Math.abs(int(r.savings.manual, 0)) }
      : legacy && r.investment
        ? { mode: 'manual', manual: int(r.investment, 0) }
        : { ...DEFAULT_SETTINGS.savings };
  const holderNames = Array.isArray(r.holderNames)
    ? r.holderNames.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim())
    : r.ownerName?.trim()
      ? [r.ownerName.trim()]
      : [];

  return {
    id: 'main',
    firstName: typeof r.firstName === 'string' ? r.firstName : '',
    holderNames,
    // Une base v1 est déjà configurée : pas d'accueil.
    onboarded: typeof r.onboarded === 'boolean' ? r.onboarded : legacy,
    payday,
    incomes,
    fixedCharges,
    savings,
    plannedSavingsAuto: Math.max(0, int(r.plannedSavingsAuto, 0)),
    envelopeOverride: typeof r.envelopeOverride === 'number' ? Math.round(r.envelopeOverride) : null,
    alerts: { ...DEFAULT_ALERTS, ...(r.alerts ?? {}) },
    bridgePassword: typeof r.bridgePassword === 'string' ? r.bridgePassword : '',
    initialSyncDays: Math.min(730, Math.max(1, int(r.initialSyncDays, DEFAULT_SETTINGS.initialSyncDays))),
    autoSyncHours: Math.max(0, int(r.autoSyncHours, DEFAULT_SETTINGS.autoSyncHours)),
    bankCountry: typeof r.bankCountry === 'string' && /^[A-Z]{2}$/.test(r.bankCountry) ? r.bankCountry : 'FR',
    theme: isThemeId(r.theme) ? r.theme : 'nuit',
    followSystem: typeof r.followSystem === 'boolean' ? r.followSystem : false,
    haptics: typeof r.haptics === 'boolean' ? r.haptics : true,
    reduceMotion: typeof r.reduceMotion === 'boolean' ? r.reduceMotion : false,
    fire: { ...DEFAULT_FIRE, ...(r.fire ?? {}) },
  };
}
