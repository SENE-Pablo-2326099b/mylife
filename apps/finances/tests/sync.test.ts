import { describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types';
import { CAT } from '../src/domain/defaults';
import { getSettings } from '../src/db/seed';
import { EnableBankingSource } from '../src/sync/enableBankingSource';
import { EbClient } from '../src/sync/ebClient';
import { mapEbAccount } from '../src/sync/ebMapping';
import type { EbSession, EbTransactionsPage } from '../src/sync/ebTypes';
import { computeSince, syncAll } from '../src/sync/syncEngine';
import { freshDb, sample } from './helpers';
import { PROFILE_RULES } from './profile';

/** Simule le relais : renvoie les échantillons selon l'opération demandée. */
function fakeBridge(pages: Record<string, EbTransactionsPage>, opts: { expired?: boolean } = {}) {
  const calls: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push(body);
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (opts.expired) return json(422, { error: 'Session is expired', code: 'EXPIRED_SESSION' });
    if (body.op === 'transactions') return json(200, pages[body.accountUid as string] ?? { transactions: [] });
    if (body.op === 'balances') return json(200, sample('balances.json'));
    return json(400, { error: 'op' });
  }) as typeof fetch;
  return { client: new EbClient('pw', fetchImpl), calls };
}

async function connect(database: Awaited<ReturnType<typeof freshDb>>) {
  for (const file of ['session-bnp.json', 'session-revolut.json']) {
    const s = sample<EbSession>(file);
    await database.connections.put({ id: s.session_id, aspspName: s.aspsp.name, aspspCountry: 'FR', validUntil: s.access.valid_until, createdAt: 0, status: 'active', accountIds: [] });
    for (const a of s.accounts) await database.accounts.put(mapEbAccount(a, s.aspsp.name, s.session_id));
  }
}

const BNP_UID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const REV_UID = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';

describe('synchronisation de bout en bout', () => {
  it('importe, classe, apparie les transferts et ne duplique rien à la 2e synchro', async () => {
    const database = await freshDb();
    // Règles d'un utilisateur qui a renseigné son nom et ses contacts.
    await database.rules.clear();
    await database.rules.bulkPut(PROFILE_RULES);
    await connect(database);
    const settings = await getSettings(database);
    const { client } = fakeBridge({ [BNP_UID]: sample('bnp-transactions.json'), [REV_UID]: sample('revolut-transactions.json') });
    const source = new EnableBankingSource(client);

    const now = new Date('2026-10-17T10:00:00');
    const reports = await syncAll(source, settings, database, now);
    expect(reports.every((r) => !r.error)).toBe(true);
    const all = await database.transactions.toArray();
    expect(all).toHaveLength(10 + 8);

    const find = (label: RegExp) => all.find((t) => label.test(t.label))!;
    expect(find(/Deliveroo/).categoryId).toBe(CAT.livraison);
    expect(find(/CEA CADARACHE/).categoryId).toBe(CAT.revenus);
    expect(find(/TRADE REPUBLIC/).categoryId).toBe(CAT.epargne);
    expect(find(/LANCELOT/).person).toBe('Lancelot Simon');

    // Virement BNP → Revolut de 200 € : les deux jambes appariées.
    const legs = all.filter((t) => Math.abs(t.amount) === 20000);
    expect(legs).toHaveLength(2);
    expect(legs.every((t) => t.categoryId === CAT.transferts)).toBe(true);
    expect(legs[0].transferPairId).toBe(legs[1].transferPairId);
    // Top up de 150 € également.
    const topups = all.filter((t) => Math.abs(t.amount) === 15000);
    expect(topups.every((t) => t.categoryId === CAT.transferts && t.transferPairId)).toBe(true);

    const bnp = await database.accounts.get('eb:BNPHASH-WwpbCiJhY2NvdW50IiwKImFjY291bnRfaWQi');
    expect(bnp?.balance).toBe(79715);

    const again = await syncAll(source, settings, database, new Date('2026-10-17T18:00:00'));
    expect(again.reduce((s, r) => s + r.added, 0)).toBe(0);
    expect(await database.transactions.count()).toBe(18);
  });

  it('marque la connexion expirée et le signale', async () => {
    const database = await freshDb();
    await connect(database);
    const { client } = fakeBridge({}, { expired: true });
    const reports = await syncAll(new EnableBankingSource(client), await getSettings(database), database, new Date('2026-10-17T10:00:00'));
    expect(reports.every((r) => r.expired)).toBe(true);
    expect((await database.connections.toArray()).every((c) => c.status === 'expired')).toBe(true);
  });

  it('demande la bonne fenêtre de dates', () => {
    const acc = { lastSyncAt: null } as Account;
    expect(computeSince(acc, [], '2026-10-17', { initialSyncDays: 90 })).toBe('2026-07-19');
    const synced = { lastSyncAt: new Date('2026-10-15T12:00:00').getTime() } as Account;
    expect(computeSince(synced, [], '2026-10-17', { initialSyncDays: 90 })).toBe('2026-10-08');
    expect(computeSince(synced, ['2026-10-01'], '2026-10-17', { initialSyncDays: 90 })).toBe('2026-10-01');
  });
});
