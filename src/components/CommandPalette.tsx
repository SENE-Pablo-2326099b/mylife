import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { useCategories } from '../hooks';
import { formatShort } from '../lib/dates';
import { openMyLifeApp } from '../lib/app';
import { formatCents } from '../ui/money';
import { normalizeText } from '../lib/text';
import { runSync } from '../sync/store';
import { Icon, type IconName } from '../ui/icons';
import { haptic, springs } from '../ui/motion';
import { Layer } from '../ui/Layer';
import { lockScroll } from '../ui/scrollLock';
import { setPaletteOpen, usePaletteOpen } from '../ui/paletteStore';
import { toast } from '../ui/toastStore';
import { useToClassifyCount } from '../domain/unclassified';

/**
 * Palette de commande : une seule porte vers tout. On tape quelques lettres et on y est — un écran,
 * une action, une opération, une catégorie — ou on pose directement la question à l'assistant.
 * Clavier : flèches, Entrée, Échap ; Ctrl/Cmd + K pour l'ouvrir de partout.
 */

interface Item {
  id: string;
  group: 'Actions' | 'Aller à' | 'Opérations' | 'Catégories' | 'Assistant';
  icon?: IconName;
  emoji?: string;
  title: string;
  hint?: string;
  right?: string;
  keywords?: string;
  run: () => void;
}

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

function score(text: string, q: string): number {
  if (!q) return 1;
  const t = normalizeText(text);
  if (t.startsWith(q)) return 3;
  if (t.includes(` ${q}`)) return 2;
  return t.includes(q) ? 1 : 0;
}

export function CommandPalette() {
  const open = usePaletteOpen();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const categories = useCategories();
  const q = normalizeText(query.trim());
  const amount = /^\d+([.,]\d{1,2})?$/.test(query.trim()) ? Math.round(Number(query.trim().replace(',', '.')) * 100) : null;
  const toClassify = useToClassifyCount();
  const ops = useLiveQuery(async (): Promise<Transaction[]> => {
    if (!open || q.length < 2) return [];
    const found = await db.transactions
      .orderBy('date')
      .reverse()
      .filter((t) => (amount !== null ? Math.abs(t.amount) === amount : normalizeText(`${t.label} ${t.note}`).includes(q)))
      .limit(6)
      .toArray();
    return found;
  }, [open, q, amount]);

  // Ctrl/Cmd + K de partout ; Échap pour fermer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const t = setTimeout(() => input.current?.focus(), 30);
    const unlock = lockScroll();
    return () => {
      clearTimeout(t);
      unlock();
    };
  }, [open]);

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
      { id: 'a-perf', group: 'Actions', icon: 'barbell', title: 'Ouvrir MyPerf', keywords: 'sport entraînement musculation', run: () => openMyLifeApp('/perf/') },
    ];
    const pages: Item[] = PAGES.map(([title, to, icon, keywords]) => ({ id: `p-${to}`, group: 'Aller à', icon, title, keywords, run: go(to) }));
    const cats: Item[] = q
      ? categories.map((c) => ({ id: `c-${c.id}`, group: 'Catégories', emoji: c.emoji, title: c.name, hint: 'Opérations de cette catégorie', run: go(`/operations?cat=${c.id}&periode=all`) }))
      : [];
    const ranked = [...actions, ...pages, ...cats]
      .map((i) => ({ i, s: Math.max(score(i.title, q), score(i.keywords ?? '', q) ? 1 : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.i);
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

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active];
      if (it) {
        haptic('tap');
        it.run();
      }
    } else if (e.key === 'Escape') {
      setPaletteOpen(false);
    }
  };

  let lastGroup = '';
  return createPortal(
    <AnimatePresence>
      {open && (
        <Layer className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <button type="button" aria-label="Fermer" className="palette-veil absolute inset-0 cursor-default" onClick={() => setPaletteOpen(false)} />
          <m.div
            role="dialog"
            aria-modal="true"
            aria-label="Rechercher et agir"
            className="glass glass-lens relative mx-auto flex max-h-[min(640px,calc(100dvh-24px))] w-[min(640px,calc(100vw-20px))] flex-col overflow-hidden rounded-xl"
            style={{ marginTop: 'calc(var(--safe-top) + 10px)' }}
            initial={{ y: -16, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: -10, scale: 0.98, transition: { duration: 0.15 } }}
            transition={springs.liquid}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Icon name="search" size={20} className="text-accent" />
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Chercher, aller, agir, demander…"
                aria-label="Chercher, aller, agir, demander"
                aria-controls="palette-list"
                aria-activedescendant={items[active] ? `pal-${items[active]!.id}` : undefined}
                className="h-[60px] min-w-0 flex-1 bg-transparent text-[18px] font-medium outline-none placeholder:text-muted focus-visible:outline-none"
                enterKeyHint="go"
              />
              <kbd className="t-caption hidden rounded-xs border border-line px-1.5 py-0.5 text-muted sm:inline">Échap</kbd>
            </div>
            <div ref={list} id="palette-list" role="listbox" className="no-scrollbar flex-1 overflow-y-auto p-2">
              {items.length === 0 && <p className="t-small px-3 py-6 text-center text-muted">Rien de trouvé.</p>}
              {items.map((it, i) => {
                const head = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                const on = i === active;
                return (
                  <div key={it.id}>
                    {head && <p className="t-label px-3 pb-1 pt-3 text-muted">{head}</p>}
                    <button
                      type="button"
                      id={`pal-${it.id}`}
                      role="option"
                      aria-selected={on}
                      data-index={i}
                      onMouseMove={() => setActive(i)}
                      onClick={() => {
                        haptic('tap');
                        it.run();
                      }}
                      className="relative flex min-h-[52px] w-full items-center gap-3 rounded-md px-3 text-left"
                    >
                      <span aria-hidden className={`bead absolute inset-0 rounded-md transition-opacity duration-150 ${on ? 'opacity-100' : 'opacity-0'}`} />
                      <span aria-hidden className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-[16px]" style={{ background: on ? 'var(--accent-soft)' : 'var(--surface-alt)' }}>
                        {it.emoji ?? (it.icon && <Icon name={it.icon} size={17} className={on ? 'text-accent' : 'text-secondary'} />)}
                      </span>
                      <span className="relative min-w-0 flex-1">
                        <span className="t-body-strong block truncate">{it.title}</span>
                        {it.hint && <span className="t-caption block truncate text-muted">{it.hint}</span>}
                      </span>
                      {it.right && <span className="num relative font-display text-[14px] font-semibold">{it.right}</span>}
                      {on && <Icon name="chevron-forward" size={16} className="relative text-accent" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </m.div>
        </Layer>
      )}
    </AnimatePresence>,
    document.body,
  );
}
