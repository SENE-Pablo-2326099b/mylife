/**
 * Toutes les sommes de l'app sont des entiers en centimes.
 * Les seules conversions texte <-> centimes passent par ce module,
 * sans jamais utiliser de nombre flottant pour le calcul.
 */

/** Convertit un montant décimal texte ("12.50", "-3", "1 234,56", "+0,5") en centimes. */
export function decimalToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (Number.isInteger(input)) return input * 100;
    input = input.toFixed(2);
  }
  let s = input.trim().replace(/[\s\u00a0\u202f€]/g, '');
  if (s === '') throw new Error(`Montant vide`);
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart = s;
  let fracPart = '';
  if (lastComma !== -1 && lastDot !== -1) {
    // Les deux sont présents : le dernier est le séparateur décimal.
    const dec = Math.max(lastComma, lastDot);
    intPart = s.slice(0, dec);
    fracPart = s.slice(dec + 1);
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.';
    const parts = s.split(sep);
    if (parts.length > 2) {
      intPart = parts.join(''); // "1.234.567" : séparateurs de milliers
    } else {
      intPart = parts[0];
      fracPart = parts[1];
    }
  }
  intPart = intPart.replace(/[.,']/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || (intPart === '' && fracPart === '')) {
    throw new Error(`Montant invalide : "${input}"`);
  }
  const euros = intPart === '' ? 0 : parseInt(intPart, 10);
  let cents: number;
  if (fracPart.length <= 2) {
    cents = parseInt(fracPart.padEnd(2, '0') || '0', 10);
  } else {
    // arrondi au centime le plus proche (demi vers le haut)
    const firstTwo = parseInt(fracPart.slice(0, 2), 10);
    cents = firstTwo + (parseInt(fracPart[2], 10) >= 5 ? 1 : 0);
  }
  const total = euros * 100 + cents;
  return negative ? -total : total;
}

/** Variante tolérante : renvoie null si la saisie n'est pas un montant. */
export function tryDecimalToCents(input: string): number | null {
  try {
    return decimalToCents(input);
  } catch {
    return null;
  }
}

const NNBSP = ' ';

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

export interface FormatOptions {
  /** Affiche toujours le signe (+ / −). */
  sign?: boolean;
  /** Masque ",00" pour les montants ronds. */
  compact?: boolean;
  /** N'affiche pas le symbole €. */
  noSymbol?: boolean;
}

/** Formate des centimes en euros à la française : "1 537,00 €". */
export function formatCents(cents: number, opts: FormatOptions = {}): string {
  const abs = Math.abs(Math.round(cents));
  const euros = Math.trunc(abs / 100);
  const rest = abs % 100;
  let body = groupThousands(euros);
  if (!(opts.compact && rest === 0)) body += ',' + String(rest).padStart(2, '0');
  let prefix = '';
  if (cents < 0) prefix = '−';
  else if (opts.sign && cents > 0) prefix = '+';
  return prefix + body + (opts.noSymbol ? '' : ' €');
}

/** Valeur d'un champ de saisie en euros, à partir de centimes ("1537" ou "12,50"). */
export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  const s = Math.trunc(abs / 100) + (abs % 100 === 0 ? '' : ',' + String(abs % 100).padStart(2, '0'));
  return (cents < 0 ? '-' : '') + s;
}

/** Division entière de centimes arrondie vers le bas (budget journalier prudent). */
export function divideCents(cents: number, parts: number): number {
  if (parts <= 0) return cents;
  return Math.floor(cents / parts);
}

/** Pourcentage entier (0-100+) sans flottant exposé. */
export function percent(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part * 100) / total);
}
