import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { MyLifeAction } from '@mylife/lumen';
import { completeBankConnection, getPendingAuth, parseCallback, startBankConnection } from '../app/src/modules/finances/bank/connect';
import { assignIds, mergeTransactions } from '../app/src/modules/finances/bank/dedup';
import { mapEbTransaction } from '../app/src/modules/finances/bank/mapping';
import { decimalToCents } from '../app/src/modules/finances/bank/money';
import { cents } from '../app/src/modules/finances/pages/labels';
import type { IncomingTransaction, Relay } from '../app/src/modules/finances/bank/relay';
import { SourceError } from '../app/src/modules/finances/bank/relay';
import { computeSince, syncAccount, syncAll, type Fetcher } from '../app/src/modules/finances/bank/sync';
import { migrate } from '../app/src/modules/finances/core/migrate';
import { buildExport } from '../app/src/modules/finances/data/export';
import { changeTracker, facts, FactsDB, factsPending, factsStore, type RawAccount } from '../app/src/modules/finances/data/facts';
import { actionChange, copilotCard } from '../app/src/modules/finances/data/publish';
import { readState, statePending, stateStore, stateTouched, writeInitial, writeState } from '../app/src/modules/finances/data/stateStore';
import { bankBuys, planOccurrences, priceLookup, recordSnapshot, refreshQuotes, runDuePlans } from '../app/src/modules/finances/data/upkeep';
import { compute } from '../app/src/modules/finances/engine/engine';
import { fromV3 } from '../app/src/modules/finances/engine/fromV3';
import { addAccount, applyState, classifyMerchant, initState, patchSettings, saveCommitment, saveTag, type EngineState } from '../app/src/modules/finances/engine/state';
import { diffRows, fromRows, toRows } from '../app/src/modules/finances/engine/stateRows';
import { roleDefaults } from '../app/src/modules/finances/engine/schema';

/** Étape M6 : la banque, la synchro entre appareils et l'entretien du patrimoine dans le nouveau module. Données fictives. */

const incoming = (over: Partial<IncomingTransaction> = {}): IncomingTransaction => ({ date: '2026-11-10', bookingDate: '2026-11-10', amount: -1250, currency: 'EUR', label: 'Epicerie du Coin', rawText: 'EPICERIE DU COIN', counterparty: null, counterpartyIban: null, pending: false, balanceAfter: null, externalId: null, mcc: null, ...over });
const account = (over: Partial<RawAccount> = {}): RawAccount => ({ id: 'eb:a', name: 'Compte', bank: 'Banque', iban: null, currency: 'EUR', source: 'enablebanking', connectionId: 'sess', remoteUid: 'uid', balance: null, balanceDate: null, lastSyncAt: null, lastSyncError: null, hidden: false, kind: 'current', ...over });
let n = 0;
const freshDb = () => {
  const d = new FactsDB(`faits-${++n}`);
  d.use(changeTracker);
  return d;
};
const base = () =>
  fromV3(
    migrate({
      accounts: [{ id: 'acc', name: 'Compte', balance: 100000, kind: 'current' }],
      categories: [{ id: 'courses', name: 'Courses', kind: 'variable', order: 0 }],
      transactions: [{ id: 't1', accountId: 'acc', date: '2026-11-10', amount: -1250, label: 'EPICERIE DU COIN', categoryId: 'courses' }],
      settings: { payday: 1, incomes: [{ id: 'i', label: 'Salaire', amount: 200000, day: 1 }], fixedCharges: [{ id: 'c', label: 'Loyer', amount: 70000, day: 3 }] },
    }),
  );
const norm = (s: EngineState) => JSON.parse(JSON.stringify(s)) as EngineState;

describe('banque', () => {
  it('les identifiants des opérations sont ceux de l’ancienne app : les deux peuvent synchroniser la même base', async () => {
    // Chargée par son adresse : l'ancienne app a ses propres réglages de compilation.
    const old = (await import(/* @vite-ignore */ new URL('../apps/finances/src/domain/dedup.ts', import.meta.url).href)) as { assignIds: typeof assignIds };
    const lot = [incoming(), incoming(), incoming({ pending: true, label: 'Café Été', amount: -150 }), incoming({ date: '2026-11-11', amount: 200000, label: 'VIR EMPLOYEUR' })];
    expect(assignIds('eb:a', lot).map((x) => x.id)).toEqual(old.assignIds('eb:a', lot).map((x) => x.id));
  });

  it('les montants sont lus en centimes comme du texte : pas d’erreur d’arrondi, rien d’absurde accepté', () => {
    expect(decimalToCents('1.005')).toBe(101); // en nombre à virgule : 100,4999… → 100
    expect(decimalToCents('1 234,56 €')).toBe(123456);
    expect(decimalToCents('-0,07')).toBe(-7);
    expect(decimalToCents(19.99)).toBe(1999);
    expect(() => decimalToCents('9007199254740993')).toThrow();
    expect(() => decimalToCents(Number.NaN)).toThrow();
    expect(() => decimalToCents(Number.POSITIVE_INFINITY)).toThrow();
    // La saisie dans les écrans : positif seulement, null sinon.
    expect(cents('300')).toBe(30000);
    expect(cents('300,50')).toBe(30050);
    expect(cents('1,005')).toBe(101);
    expect(cents(' 1 200 ')).toBe(120000);
    for (const bad of ['', '  ', 'abc', '-5', '1e3', '12,3,4x', '99999999999999999']) expect(cents(bad)).toBeNull();
  });

  it('une opération de la banque est normalisée ; une opération annulée est écartée', () => {
    const t = mapEbTransaction({ transaction_amount: { amount: '12.50', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-11-10', creditor: { name: 'CB EPICERIE DU COIN 12/11' }, entry_reference: 'ref1' });
    expect(t).toMatchObject({ amount: -1250, date: '2026-11-10', label: 'EPICERIE DU COIN', pending: false, externalId: 'ref1' });
    expect(mapEbTransaction({ transaction_amount: { amount: '1', currency: 'EUR' }, status: 'CNCL', booking_date: '2026-11-10' })).toBeNull();
  });

  it('première synchro, puis la même : aucune opération en double ; le solde suit ; les changements partent vers le compte', async () => {
    const d = freshDb();
    await d.accounts.put(account());
    const before = factsPending();
    const lot = [incoming(), incoming({ amount: -3000, label: 'Boulangerie', externalId: 'r2' })];
    const fetcher: Fetcher = async () => ({ transactions: lot, balance: { amount: 95750, date: '2026-11-10T08:00:00Z' } });
    const first = await syncAccount(account(), fetcher, { initialSyncDays: 90 }, d, new Date('2026-11-10T09:00:00'));
    expect(first).toMatchObject({ added: 2, duplicates: 0 });
    expect((await d.accounts.get('eb:a'))!.balance).toBe(95750);
    const again = await syncAccount((await d.accounts.get('eb:a'))!, fetcher, { initialSyncDays: 90 }, d, new Date('2026-11-10T15:00:00'));
    expect(again).toMatchObject({ added: 0, duplicates: 2 });
    expect(await d.transactions.count()).toBe(2);
    expect(factsPending()).toBeGreaterThan(before);
    // Ce qui vient d'un autre appareil est appliqué sans être renvoyé.
    const store = factsStore(d);
    await store.clearPending();
    await store.apply([{ tbl: 'transactions', rid: 'x', deleted: false, row: { ...(await d.transactions.toArray())[0], id: 'x' } }]);
    expect(await d.transactions.count()).toBe(3);
    expect(factsPending()).toBe(0);
  });

  it('deux opérations identiques le même jour, renvoyées dans un autre ordre : aucune perdue, aucune en double', () => {
    // Le matin, un café (référence a) ; le soir, la banque renvoie le second café (b) avant le premier.
    const first = mergeTransactions('eb:a', [], [incoming({ externalId: 'a' })], 'enablebanking', 1).toAdd;
    const evening = mergeTransactions('eb:a', first, [incoming({ externalId: 'b' }), incoming({ externalId: 'a' })], 'enablebanking', 2);
    expect(evening).toMatchObject({ duplicates: 1, newBooked: 1 });
    expect(evening.toAdd.map((t) => t.externalId)).toEqual(['b']);
    const ids = [...first, ...evening.toAdd].map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
    // Le lendemain, dans l'ordre d'origine ou non, plus rien de nouveau.
    const all = [...first, ...evening.toAdd];
    expect(mergeTransactions('eb:a', all, [incoming({ externalId: 'a' }), incoming({ externalId: 'b' })], 'enablebanking', 3)).toMatchObject({ duplicates: 2, newBooked: 0 });
    expect(mergeTransactions('eb:a', all, [incoming({ externalId: 'b' }), incoming({ externalId: 'a' })], 'enablebanking', 3)).toMatchObject({ duplicates: 2, newBooked: 0 });
    // Sans référence bancaire (anciennes données, banque qui n'en donne pas), l'identifiant suffit, comme avant.
    const legacy = first.map((t) => ({ ...t, externalId: null }));
    expect(mergeTransactions('eb:a', legacy, [incoming({ externalId: 'a' })], 'enablebanking', 4)).toMatchObject({ duplicates: 1, newBooked: 0 });
    // Trois nouvelles dont deux qui tombent sur des rangs déjà pris : identifiants tous distincts.
    const three = mergeTransactions('eb:a', first, [incoming({ externalId: 'c' }), incoming({ externalId: 'd' }), incoming({ externalId: 'a' })], 'enablebanking', 5).toAdd;
    expect(new Set([...first, ...three].map((t) => t.id)).size).toBe(3);
  });

  it('une opération en attente devient définitive : elle garde ce qui a été décidé à la main', () => {
    const pending = mergeTransactions('eb:a', [], [incoming({ pending: true })], 'enablebanking', 1).toAdd;
    pending[0]!.categoryId = 'courses';
    pending[0]!.categorySource = 'manual';
    const merge = mergeTransactions('eb:a', pending, [incoming({ date: '2026-11-11' })], 'enablebanking', 2);
    expect(merge.settled).toBe(1);
    expect(merge.toDelete).toEqual([pending[0]!.id]);
    expect(merge.toAdd[0]).toMatchObject({ pending: false, categoryId: 'courses', categorySource: 'manual' });
  });

  it('la reprise part de la dernière synchro moins sept jours, ou de l’opération en attente la plus ancienne', () => {
    expect(computeSince({ lastSyncAt: null }, [], '2026-11-10', 90)).toBe('2026-08-12');
    expect(computeSince({ lastSyncAt: new Date('2026-11-09T10:00:00').getTime() }, [], '2026-11-10', 90)).toBe('2026-11-02');
    expect(computeSince({ lastSyncAt: new Date('2026-11-09T10:00:00').getTime() }, ['2026-10-20'], '2026-11-10', 90)).toBe('2026-10-20');
  });

  it('accès expiré : dit sur le compte, la connexion est marquée, les autres comptes continuent', async () => {
    const d = freshDb();
    await d.accounts.bulkPut([account(), account({ id: 'eb:b', connectionId: 'autre' })]);
    await d.connections.bulkPut([
      { id: 'sess', aspspName: 'Banque', aspspCountry: 'FR', validUntil: '2030-01-01T00:00:00Z', createdAt: 0, status: 'active', accountIds: ['eb:a'] },
      { id: 'autre', aspspName: 'Autre', aspspCountry: 'FR', validUntil: '2030-01-01T00:00:00Z', createdAt: 0, status: 'active', accountIds: ['eb:b'] },
    ]);
    const fetcher: Fetcher = async (a) => {
      if (a.id === 'eb:a') throw new SourceError('Consentement expiré', true);
      return { transactions: [incoming()], balance: null };
    };
    const reports = await syncAll(fetcher, { initialSyncDays: 90 }, d, new Date('2026-11-10T09:00:00'));
    expect(reports.find((r) => r.accountId === 'eb:a')).toMatchObject({ expired: true });
    expect(reports.find((r) => r.accountId === 'eb:b')).toMatchObject({ added: 1 });
    expect((await d.connections.get('sess'))!.status).toBe('expired');
  });

  it('relier une banque : l’adresse de retour est celle déclarée, on revient au module ; un compte déjà connu garde son historique', async () => {
    const d = freshDb();
    await d.accounts.put(account({ id: 'eb:h1', nickname: 'Mon compte', remoteUid: null, connectionId: 'vieux' }));
    let asked: { redirectUrl: string; state: string } | null = null;
    let went = '';
    const relay = {
      startAuth: async (p: { redirectUrl: string; state: string }) => ((asked = p), { url: 'https://banque.test/auth', authorization_id: 'a' }),
      createSession: async () => ({ session_id: 'neuf', accounts: [{ uid: 'u1', identification_hash: 'h1', currency: 'EUR', account_id: { iban: 'FR76 0000' } }, { uid: null, identification_hash: 'h2', currency: 'EUR' }], aspsp: { name: 'Banque', country: 'FR' }, access: { valid_until: '2027-02-01T00:00:00Z' } }),
    } as unknown as Relay;
    await startBankConnection(relay, { name: 'Banque', country: 'FR' }, d, (url) => (went = url), 'https://mylife.test');
    expect(went).toBe('https://banque.test/auth');
    expect(asked!.redirectUrl).toBe('https://mylife.test/finances/connexion/retour');
    expect(await getPendingAuth(d)).toMatchObject({ returnTo: '/argent/banques', state: asked!.state });
    await expect(completeBankConnection(relay, 'code', 'pas-le-bon', d)).rejects.toThrow(/ne correspond pas/);
    const done = await completeBankConnection(relay, 'code', asked!.state, d);
    expect(done).toHaveLength(1);
    expect(await d.accounts.get('eb:h1')).toMatchObject({ nickname: 'Mon compte', remoteUid: 'u1', connectionId: 'neuf', iban: 'FR760000' });
    expect(await getPendingAuth(d)).toBeUndefined();
    expect(parseCallback('https://mylife.test/finances/connexion/retour?code=abc&state=s1')).toEqual({ code: 'abc', state: 's1', error: null });
    expect(parseCallback('https://x.test/?error=access_denied').error).toBe('access_denied');
  });
});

describe('patrimoine : entretien', () => {
  it('investissement programmé : les échéances passées deviennent des achats, une seule fois', async () => {
    expect(planOccurrences({ frequency: 'monthly', day: 31, startDate: '2026-01-01' }, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    const d = freshDb();
    await d.table('holdings').put({ id: 'h', portfolioId: 'p', name: 'ETF Monde', price: 50000, quoteSource: 'manual', symbol: null });
    await d.table('plans').put({ id: 'pl', holdingId: 'h', amount: 10000, frequency: 'monthly', day: 5, startDate: '2026-09-01', active: true, lastRunDate: null });
    expect(await runDuePlans(d, '2026-11-10')).toBe(3);
    expect(await runDuePlans(d, '2026-11-10')).toBe(0);
    expect((await d.table('investmentOps').toArray())[0]).toMatchObject({ type: 'buy', amount: 10000, quantity: 0.2, estimated: true });
  });

  it('prélèvement d’une ligne reliée : un achat au cours du jour, jamais deux fois ; cours et photo du jour', async () => {
    const h = { id: 'h', portfolioId: 'p', name: 'Bitcoin', assetClass: 'crypto' as const, symbol: 'bitcoin', quoteSource: 'coingecko' as const, isin: null, price: 5_000_000, priceAt: null, order: 0, createdAt: 0, bankKeyword: 'bitstack', bankLinkFrom: '2026-11-01' };
    const tx = { ...mergeTransactions('eb:a', [], [incoming({ label: 'Bitstack', rawText: 'PRLV BITSTACK', amount: -5000, date: '2026-11-05' })], 'enablebanking', 1).toAdd[0]! };
    const buys = bankBuys(h, [tx], [], priceLookup([['2026-11-04', 40000]], h.price));
    expect(buys).toHaveLength(1);
    expect(buys[0]).toMatchObject({ type: 'buy', amount: 5000, quantity: 0.00125, bankTxId: tx.id });
    expect(bankBuys(h, [tx], buys, () => null)).toEqual([]);

    const d = freshDb();
    await d.accounts.bulkPut([account({ balance: 120000 }), account({ id: 'eb:cache', balance: 999, hidden: true })]);
    await d.table('portfolios').put({ id: 'p', name: 'Crypto' });
    await d.table('holdings').put(h);
    await d.table('investmentOps').bulkPut(buys);
    await d.table('manualAssets').bulkPut([{ id: 'v', name: 'Voiture', kind: 'asset', value: 800000 }, { id: 'pret', name: 'Prêt', kind: 'debt', value: 300000 }]);
    const relay = { quotes: async () => ({ 'coingecko:bitcoin': { price: 60000, at: 5 } }) } as unknown as Relay;
    expect(await refreshQuotes({ force: true }, d, relay)).toEqual({ updated: 1, errors: [] });
    await recordSnapshot(d, '2026-11-10');
    expect(await d.table('snapshots').get('2026-11-10')).toEqual({ date: '2026-11-10', cash: 120000, investments: 7500, invested: 5000, other: 800000, debts: 300000 });
  });
});

describe('réglages du moteur entre appareils', () => {
  it('découpés en lignes puis recomposés : le même état, dans le même ordre', () => {
    let s = initState(base());
    s = saveCommitment(s, { ...s.commitments[0]!, id: 'neuf', label: 'Abonnement' });
    s = classifyMerchant(s, 'm:epicerie coin', 'EXPENSE', 'courses');
    s = saveTag(s, { id: 'tag1', name: 'imprévu' } as never);
    s = addAccount(s, { id: 'cash', name: 'Espèces', provider: '', role: 'CASH', ...roleDefaults('CASH'), currency: 'EUR', ownershipRatio: 1, alertThreshold: null, deferredDebit: null, source: 'manual', balance: 2000, balanceAt: 1, archivedAt: null });
    expect(norm(fromRows(toRows(s))!)).toEqual(norm(s));
    expect(fromRows(new Map())).toBeNull();
  });

  it('deux appareils changent deux choses différentes : rien n’est écrasé', () => {
    const start = initState(base());
    const a = patchSettings(start, { payday: 28 });
    const b = classifyMerchant(start, 'm:boulangerie', 'EXPENSE', 'courses');
    const changedByB = diffRows(toRows(start), toRows(b));
    expect(changedByB).toHaveLength(1);
    const rows = toRows(a);
    for (const k of changedByB) rows.set(k, toRows(b).get(k));
    const merged = fromRows(rows)!;
    expect(merged.settings.payday).toBe(28);
    expect(merged.merchantDefaults).toEqual({ 'm:boulangerie': { flow: 'EXPENSE', categoryId: 'courses' } });
  });

  it('sur l’appareil : les réglages de départ partent sans rien écraser, un changement part daté ; ceux d’un autre appareil s’appliquent sans repartir', async () => {
    const store = stateStore();
    const start = initState(base());
    expect(await writeInitial(start)).toBe(start);
    // Arrivés entre-temps d'un autre appareil, des réglages ne seraient pas remplacés par ceux de départ.
    expect((await writeInitial(patchSettings(start, { payday: 9 }))).settings.payday).toBe(start.settings.payday);
    // Les réglages de départ partent avec la date la plus ancienne : ils ne remplacent rien dans le compte.
    const initial = await store.pending(500);
    expect(initial.length).toBeGreaterThan(3);
    expect(new Set(initial.map((p) => p.updatedAt))).toEqual(new Set([1]));
    await store.ack(initial);
    expect(statePending()).toBe(0);
    expect(await stateTouched()).toBe(false);
    const next = patchSettings(start, { payday: 28 });
    await writeState(next, { touched: true, before: start });
    expect(await stateTouched()).toBe(true);
    const pending = await store.pending(100);
    expect(pending.map((p) => `${p.tbl}/${p.rid}`)).toEqual(['single/settings']);
    await store.ack(pending);
    expect(statePending()).toBe(0);
    // Un autre appareil a classé un marchand et retiré un engagement.
    const gone = start.commitments[0]!.id;
    await store.apply([
      { tbl: 'merchantDefaults', rid: 'm:x', deleted: false, row: { flow: 'EXPENSE', categoryId: 'courses' } },
      { tbl: 'commitments', rid: gone, deleted: true, row: null },
    ]);
    const now = (await readState())!;
    expect(now.merchantDefaults).toEqual({ 'm:x': { flow: 'EXPENSE', categoryId: 'courses' } });
    expect(now.commitments.some((c) => c.id === gone)).toBe(false);
    expect(now.settings.payday).toBe(28);
    expect(statePending()).toBe(0);
    // Prendre les réglages du compte : ceux de l'appareil sont gardés de côté.
    await store.replace((await store.snapshot()).map((r) => ({ ...r, deleted: false })));
    expect(norm((await readState())!)).toEqual(norm(now));
    expect(await stateTouched()).toBe(false);
    await store.forget!();
    expect(await readState()).toBeUndefined();
  });
});

describe('ce que le module dépose pour MyLife', () => {
  it('fiche Copilot en euros, et « sauter un engagement » validé dans Copilot, avec son annulation', () => {
    const b = base();
    const s = initState(b);
    const db = applyState(b, s);
    const e = compute(db, '2026-11-10');
    const card = copilotCard(db, e) as { day: string; remainingToday: number; recurring: { id: string; label: string }[] };
    expect(card.day).toBe('2026-11-10');
    expect(card.remainingToday).toBe(Math.round(e.resteAujourdhui) / 100);
    const charge = e.occurrences.find((o) => o.commitment.kind === 'CHARGE')!;
    expect(card.recurring.map((r) => r.id)).toContain(charge.commitment.id);
    const action = (itemId: string, skip: boolean) => ({ id: 'a', app: 'finances', kind: 'finances.skipRecurring', params: { itemId, skip }, summary: 'x', createdAt: 0, status: 'pending' }) as MyLifeAction;
    const { change, undo } = actionChange(action(charge.commitment.id, true), e);
    const skipped = compute(applyState(b, change(s)), '2026-11-10');
    expect(skipped.occurrences.find((o) => o.id === charge.id)!.status).toBe('SKIPPED');
    expect(undo.params).toEqual({ itemId: charge.commitment.id, skip: false });
    const income = e.occurrences.find((o) => o.commitment.kind === 'INCOME')!;
    expect(() => actionChange(action(income.commitment.id, true), e)).toThrow(/revenu/);
    expect(() => actionChange(action('inconnu', true), e)).toThrow(/échéance/);
  });

  it('export : tout y est, sauf le mot de passe du relais et l’autorisation bancaire en cours', async () => {
    await facts.settings.put({ id: 'main', bridgePassword: 'secret-fictif', payday: 5 });
    await facts.meta.bulkPut([{ key: 'pendingAuth', value: { state: 's' } }, { key: 'lastSyncAt', value: 1 }]);
    await facts.accounts.put(account());
    const out = (await buildExport()) as { format: string; tables: Record<string, Record<string, unknown>[]> };
    expect(out.format).toBe('myfinances-backup');
    expect(JSON.stringify(out)).not.toContain('secret-fictif');
    expect(out.tables.meta!.map((m) => m.key)).toEqual(['lastSyncAt']);
    expect(out.tables.accounts).toHaveLength(1);
    expect(out.tables.settings![0]!.payday).toBe(5);
  });
});
