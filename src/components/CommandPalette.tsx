import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { useCategories } from '../hooks';
import { formatShort } from '../lib/dates';
import { formatCents } from '../ui/money';
import { runSync } from '../sync/store';
import { CommandPalette } from '../ui/CommandPalette';
import type { IconName } from '../ui/icons';
import { foldText, rankItems, usePaletteQuery, type PaletteItem } from '../ui/palette';
import { setPaletteOpen, usePaletteOpen } from '../ui/paletteStore';
import { toast } from '../ui/toastStore';
import { useToClassifyCount } from '../domain/unclassified';

type Item = PaletteItem;

const PAGES: [string, string, IconName, string][] = [
  ['Aujourd’hui', '/', 'flash', 'accueil budget du jour'],
  ['Budget du cycle', '/budget', 'pie', 'cycle statistiques calendrier'],
  ['Opérations', '/operations', 'list', 'transactions dépenses'],
  ['À classer', '/a-classer', 'tag', 'catégoriser'],
  ['Patrimoine', '/patrimoine', 'diamond', 'net worth comptes'],
  ['Placements', '/patrimoine?vue=placements', 'trend-up', 'portefeuille etf pea crypto bourse'],
  ['Objectifs d’épargne', '/patrimoine?vue=objectifs', 'flag', 'épargne goals'],
  ['Indépendance financière', '/independance', 'rocket', 'fire simulateur intérêts composés retraite'],
  ['Prévision de trésorerie', '/previsions', 'trend-down', 'solde futur paie'],
  ['Abonnements et récurrents', '/recurrents', 'repeat', 'abonnements prélèvements'],
  ['Alertes', '/alertes', 'bell', 'notifications'],
  ['Banques', '/synchro', 'bank', 'enable banking connexion'],
  ['Réglages', '/reglages', 'options', 'paramètres'],
  ['Compte MyLife', '/reglages/compte', 'lock', 'synchro chiffrée appareils'],
  ['Revenus, charges et épargne', '/reglages/budget', 'cash', 'salaire loyer enveloppe'],
  ['Catégories', '/reglages/categories', 'tag', 'objectifs dépenses'],
  ['Règles de classement', '/reglages/regles', 'rules', 'mots-clés'],
  ['Apparence', '/reglages/apparence', 'palette', 'thème couleurs sombre clair'],
  ['Sauvegarde et données', '/reglages/donnees', 'shield', 'export import démo'],
];


/**
 * Les entrées de MyFinances dans la palette commune (src/ui/CommandPalette) : écrans, actions,
 * opérations, catégories, question à l'assistant. La palette y ajoute les autres apps MyLife.
 */
export function FinancesPalette() {
  const open = usePaletteOpen();
  const navigate = useNavigate();
  const query = usePaletteQuery();
  const categories = useCategories();
  const q = foldText(query.trim());
  const amount = /^\d+([.,]\d{1,2})?$/.test(query.trim()) ? Math.round(Number(query.trim().replace(',', '.')) * 100) : null;
  const toClassify = useToClassifyCount();
  const ops = useLiveQuery(async (): Promise<Transaction[]> => {
    if (!open || q.length < 2) return [];
    const found = await db.transactions
      .orderBy('date')
      .reverse()
      .filter((t) => (amount !== null ? Math.abs(t.amount) === amount : foldText(`${t.label} ${t.note}`).includes(q)))
      .limit(6)
      .toArray();
    return found;
  }, [open, q, amount]);

  const go = (to: string) => () => {
    setPaletteOpen(false);
    navigate(to);
  };

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { id: 'a-sync', group: 'Actions', icon: 'sync', title: 'Synchroniser les banques', keywords: 'actualiser rafraîchir', run: () => {
          setPaletteOpen(false);
          void runSync().then((r) => r && toast({ message: `Banques à jour · ${r.reduce((s, x) => s + x.added, 0)} nouvelle(s) opération(s)` }));
        } },
      ...(toClassify > 0 ? [{ id: 'a-classify', group: 'Actions' as const, icon: 'tag' as IconName, title: `Classer ${toClassify} opération${toClassify > 1 ? 's' : ''}`, run: go('/a-classer') }] : []),
      { id: 'a-ask', group: 'Actions', icon: 'sparkles', title: 'Demander à l’assistant', keywords: 'claude ia question', run: go('/assistant') },
      { id: 'a-tr', group: 'Actions', icon: 'upload', title: 'Importer un relevé Trade Republic', keywords: 'pdf', run: go('/patrimoine/import') },
      { id: 'a-goal', group: 'Actions', icon: 'flag', title: 'Nouvel objectif d’épargne', run: go('/patrimoine?vue=objectifs&ajouter=1') },
      { id: 'a-invest', group: 'Actions', icon: 'trend-up', title: 'Ajouter un placement', run: go('/patrimoine?vue=placements&ajouter=1') },
      { id: 'a-asset', group: 'Actions', icon: 'home', title: 'Ajouter un bien ou une dette', run: go('/patrimoine?vue=biens&ajouter=1') },
    ];
    const pages: Item[] = PAGES.map(([title, to, icon, keywords]) => ({ id: `p-${to}`, group: 'Aller à', icon, title, keywords, run: go(to) }));
    const cats: Item[] = q
      ? categories.map((c) => ({ id: `c-${c.id}`, group: 'Catégories', emoji: c.emoji, title: c.name, hint: 'Opérations de cette catégorie', run: go(`/operations?cat=${c.id}&periode=all`) }))
      : [];
    const ranked = rankItems([...actions, ...pages, ...cats], q);
    const shown = q ? ranked.slice(0, 9) : [...actions.slice(0, 6), ...pages.slice(0, 7)];
    const opItems: Item[] = (ops ?? []).map((t) => ({
      id: `o-${t.id}`,
      group: 'Opérations',
      icon: t.amount < 0 ? 'arrow-up' : 'arrow-down',
      title: t.label,
      hint: formatShort(t.date),
      right: formatCents(t.amount, { sign: true }),
      run: go(`/operations?q=${encodeURIComponent(query.trim())}&periode=all`),
    }));
    const ask: Item[] = q
      ? [{ id: 'ask', group: 'Assistant', icon: 'sparkles', title: `Demander : « ${query.trim()} »`, hint: 'L’assistant lit tes données pour répondre', run: go(`/assistant?q=${encodeURIComponent(query.trim())}`) }]
      : [];
    return [...shown, ...opItems, ...ask];
  }, [q, query, categories, ops, toClassify]); // eslint-disable-line react-hooks/exhaustive-deps

  return <CommandPalette items={items} placeholder="Chercher, aller, agir, demander…" />;
}
