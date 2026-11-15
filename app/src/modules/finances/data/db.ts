import Dexie, { type EntityTable, type Table } from 'dexie';
import type { OccurrenceOverride } from '../engine/schema';
import type { Account, Category, FinanceData, FinanceSettings, Goal, GoalMove, Holding, InvestmentOp, Merchant, Movement, Planned, Snapshot } from '../core/model';

/**
 * La base locale de MyFinances V5. Elle vit sur l'appareil ; elle est effacée quand un autre compte se connecte
 * (`claimDevice`, packages/sync-client). La synchro entre appareils viendra avec la bascule (étape 3.7) : d'ici là,
 * elle se remplit en reprenant les données de l'ancienne app (`importOld.ts`).
 */
export const DB_NAME = 'mylife-finances';

class FinanceDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  movements!: EntityTable<Movement, 'id'>;
  merchants!: EntityTable<Merchant, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  planned!: EntityTable<Planned, 'id'>;
  holdings!: EntityTable<Holding, 'id'>;
  investmentOps!: EntityTable<InvestmentOp, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  goalMoves!: EntityTable<GoalMove, 'id'>;
  snapshots!: EntityTable<Snapshot, 'date'>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      accounts: 'id, family',
      movements: 'id, accountId, date, merchantId, nature',
      merchants: 'id',
      categories: 'id, order',
      planned: 'id, kind',
      holdings: 'id, accountId',
      investmentOps: 'id, holdingId, date',
      goals: 'id',
      goalMoves: 'id, goalId',
      snapshots: 'date',
      meta: 'key',
    });
  }
}

export const db = new FinanceDB();

const DEFAULT_SETTINGS: FinanceSettings = { payday: 1 };

export async function loadAll(): Promise<FinanceData> {
  const [accounts, movements, merchants, categories, planned, holdings, investmentOps, goals, goalMoves, snapshots, settings] = await Promise.all([
    db.accounts.toArray(),
    db.movements.toArray(),
    db.merchants.toArray(),
    db.categories.orderBy('order').toArray(),
    db.planned.toArray(),
    db.holdings.toArray(),
    db.investmentOps.toArray(),
    db.goals.toArray(),
    db.goalMoves.toArray(),
    db.snapshots.toArray(),
    db.meta.get('settings'),
  ]);
  return { accounts: accounts.sort((a, b) => a.order - b.order), movements, merchants, categories, planned, holdings, investmentOps, goals, goalMoves, snapshots, settings: { ...DEFAULT_SETTINGS, ...((settings?.value as Partial<FinanceSettings> | undefined) ?? {}) } };
}

/** Remplace tout le contenu, d'un seul geste (tout ou rien). */
export async function saveAll(data: FinanceData): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.filter((t) => t.name !== 'meta').map((t) => t.clear()));
    await Promise.all([
      db.accounts.bulkPut(data.accounts),
      db.movements.bulkPut(data.movements),
      db.merchants.bulkPut(data.merchants),
      db.categories.bulkPut(data.categories),
      db.planned.bulkPut(data.planned),
      db.holdings.bulkPut(data.holdings),
      db.investmentOps.bulkPut(data.investmentOps),
      db.goals.bulkPut(data.goals),
      db.goalMoves.bulkPut(data.goalMoves),
      db.snapshots.bulkPut(data.snapshots),
      db.meta.put({ key: 'settings', value: data.settings }),
    ]);
  });
}

/** Les échéances décidées à la main (sautée, réglée, en partie versée). Gardées d'une reprise à l'autre. */
export async function loadOverrides(): Promise<OccurrenceOverride[]> {
  const v = (await db.meta.get('occurrenceOverrides'))?.value;
  return Array.isArray(v) ? (v as OccurrenceOverride[]) : [];
}

export async function saveOverrides(list: OccurrenceOverride[]): Promise<void> {
  await db.meta.put({ key: 'occurrenceOverrides', value: list });
}
