import type { Rule } from '../db/types';
import { normalizeText } from '../lib/text';

export interface MatchInput {
  label: string;
  rawText: string;
  amount: number;
}

export interface CompiledRule {
  rule: Rule;
  test: (normalized: string) => boolean;
}

/** Texte comparé aux règles : libellé + texte brut, en minuscules, sans accents ni ponctuation. */
export function matchText(tx: Pick<MatchInput, 'label' | 'rawText'>): string {
  return normalizeText(`${tx.label} ${tx.rawText}`);
}

/** Renvoie un message d'erreur si le motif est invalide, sinon null. */
export function validatePattern(pattern: string, isRegex: boolean): string | null {
  if (!pattern.trim()) return 'Motif vide';
  if (!isRegex) return normalizeText(pattern) ? null : 'Le mot-clé doit contenir au moins une lettre ou un chiffre';
  try {
    new RegExp(pattern, 'i');
    return null;
  } catch (e) {
    return `Expression régulière invalide : ${(e as Error).message}`;
  }
}

function compileOne(rule: Rule): CompiledRule | null {
  if (rule.isRegex) {
    try {
      // Les regex s'appliquent au texte normalisé (minuscules, sans accents, ponctuation → espace).
      const source = rule.pattern.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const re = new RegExp(source, 'i');
      return { rule, test: (t) => re.test(t) };
    } catch {
      return null;
    }
  }
  const kw = normalizeText(rule.pattern);
  if (!kw) return null;
  return { rule, test: (t) => t.includes(kw) };
}

/** Trie les règles actives : priorité décroissante, puis motif le plus long (plus spécifique) d'abord. */
export function compileRules(rules: Rule[]): CompiledRule[] {
  return rules
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length || a.createdAt - b.createdAt)
    .map(compileOne)
    .filter((c): c is CompiledRule => c !== null);
}

export function ruleAppliesTo(rule: Rule, tx: Pick<MatchInput, 'amount'>): boolean {
  if (rule.direction === 'debit' && tx.amount >= 0) return false;
  if (rule.direction === 'credit' && tx.amount <= 0) return false;
  const abs = Math.abs(tx.amount);
  if (rule.minAmount !== null && abs < rule.minAmount) return false;
  if (rule.maxAmount !== null && abs > rule.maxAmount) return false;
  return true;
}

export function findMatchingRule(compiled: CompiledRule[], tx: MatchInput): Rule | null {
  const text = matchText(tx);
  for (const c of compiled) {
    if (ruleAppliesTo(c.rule, tx) && c.test(text)) return c.rule;
  }
  return null;
}

const NOISE = new Set([
  'cb', 'carte', 'paiement', 'par', 'prlv', 'sepa', 'vir', 'virement', 'inst', 'recu', 'emis', 'facture', 'du', 'de', 'la', 'le', 'les',
  'des', 'fr', 'www', 'com', 'sas', 'sarl', 'sa', 'eur', 'payment', 'to', 'from', 'card', 'transaction', 'achat', 'prelevement',
]);

/** Propose un mot-clé de règle à partir d'un libellé ("CB INTERMARCHE AIX 12/10" → "intermarche aix"). */
export function suggestKeyword(label: string): string {
  const tokens = normalizeText(label)
    .split(' ')
    .filter((t) => t.length > 1 && !NOISE.has(t) && !/^\d+$/.test(t) && !/^x+\d+$/.test(t) && !/\d{4,}/.test(t));
  return tokens.slice(0, 2).join(' ') || normalizeText(label).split(' ')[0] || '';
}
