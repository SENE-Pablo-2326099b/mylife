import type { Account } from '../db/types';
import type { ISODate } from '../lib/dates';
import type { EbClient } from './ebClient';
import { mapEbTransaction, pickBalance } from './ebMapping';
import type { EbTransaction } from './ebTypes';
import { SourceError, type DataSource, type FetchResult } from './source';

const MAX_PAGES = 50;

export class EnableBankingSource implements DataSource {
  readonly id = 'enablebanking' as const;
  constructor(private client: EbClient) {}

  async fetchAccount(account: Account, since: ISODate, until: ISODate): Promise<FetchResult> {
    if (!account.remoteUid) throw new SourceError('Compte sans accès actif : reconnecte la banque.', true);
    const raw: EbTransaction[] = [];
    let key: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.client.transactionsPage(account.remoteUid, since, until, key);
      raw.push(...(res.transactions ?? []));
      if (!res.continuation_key) break;
      key = res.continuation_key;
    }
    let balance: FetchResult['balance'] = null;
    try {
      balance = pickBalance(await this.client.balances(account.remoteUid));
    } catch (e) {
      if (e instanceof SourceError && e.sessionExpired) throw e;
      balance = null; // le solde est facultatif
    }
    const transactions = raw.map(mapEbTransaction).filter((t): t is NonNullable<typeof t> => t !== null);
    return { transactions, balance };
  }
}
