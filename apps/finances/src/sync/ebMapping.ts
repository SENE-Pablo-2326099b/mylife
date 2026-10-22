import type { Account, AccountKind } from '../db/types';
import { isISODate } from '../lib/dates';
import { decimalToCents } from '../ui/money';
import type { EbBalance, EbSessionAccount, EbTransaction } from './ebTypes';
import type { IncomingTransaction } from './source';

const PENDING_STATUSES = new Set(['PDNG', 'HOLD']);
const IGNORED_STATUSES = new Set(['CNCL', 'RJCT', 'SCHD']);

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Retire le bruit des libellés bancaires ("CB ", "FACTURE CARTE DU 12/10", numéros de carte…). */
export function prettifyLabel(raw: string): string {
  let s = clean(raw);
  s = s.replace(/^(paiement par carte|facture carte|carte|cb|prlv sepa|prelevement|vir sepa inst|vir sepa recu|vir sepa|vir inst|virement sepa|virement|vir)\b[\s:*-]*/i, '');
  s = s.replace(/\bdu \d{6}\b/gi, '');
  s = s.replace(/\b(du )?\d{2}[/.]\d{2}([/.]\d{2,4})?\b/gi, '');
  s = s.replace(/\bcarte \d{4}[x*]+\d{2,4}\b/gi, '');
  s = s.replace(/\b\d{4}[x*]{4,}\d{2,4}\b/gi, '');
  s = s.replace(/\b[x*]{2,}\d{2,4}\b/gi, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/^[\s*:-]+|[\s*:-]+$/g, '');
  return s || clean(raw);
}

/** Convertit une opération Enable Banking en opération normalisée (null si annulée / rejetée / programmée). */
export function mapEbTransaction(tx: EbTransaction): IncomingTransaction | null {
  const status = tx.status ?? 'BOOK';
  if (IGNORED_STATUSES.has(status)) return null;
  if (!tx.transaction_amount?.amount) return null;

  let amount = decimalToCents(tx.transaction_amount.amount);
  if (tx.credit_debit_indicator === 'DBIT') amount = -Math.abs(amount);
  else if (tx.credit_debit_indicator === 'CRDT') amount = Math.abs(amount);

  const date = [tx.transaction_date, tx.booking_date, tx.value_date].find((d): d is string => !!d && isISODate(d.slice(0, 10)))?.slice(0, 10);
  if (!date) return null;
  const bookingDate = tx.booking_date && isISODate(tx.booking_date.slice(0, 10)) ? tx.booking_date.slice(0, 10) : null;

  const isDebit = amount < 0;
  const party = isDebit ? tx.creditor : tx.debtor;
  const partyAccount = isDebit ? tx.creditor_account : tx.debtor_account;
  const counterparty = clean(party?.name) || null;
  const remittance = clean((tx.remittance_information ?? []).join(' '));
  const btc = clean(tx.bank_transaction_code?.description);
  const note = clean(tx.note);

  const label = prettifyLabel(counterparty || remittance || note || btc || 'Opération');
  const rawText = [counterparty, remittance, note, btc].filter(Boolean).join(' | ');

  let balanceAfter: number | null = null;
  if (tx.balance_after_transaction?.amount) {
    try {
      balanceAfter = decimalToCents(tx.balance_after_transaction.amount);
    } catch {
      balanceAfter = null;
    }
  }

  return {
    date,
    bookingDate,
    amount,
    currency: tx.transaction_amount.currency || 'EUR',
    label,
    rawText: rawText || label,
    counterparty,
    counterpartyIban: partyAccount?.iban ? partyAccount.iban.replace(/\s+/g, '').toUpperCase() : null,
    pending: PENDING_STATUSES.has(status),
    balanceAfter,
    externalId: clean(tx.entry_reference) || clean(tx.transaction_id) || null,
    mcc: tx.merchant_category_code ?? null,
  };
}

const BALANCE_PREFERENCE = ['ITAV', 'CLAV', 'XPCD', 'ITBD', 'CLBD', 'OTHR', 'INFO'];

/** Choisit le solde le plus « disponible » parmi ceux renvoyés par la banque. */
export function pickBalance(balances: EbBalance[]): { amount: number; date: string } | null {
  if (!balances.length) return null;
  const sorted = [...balances].sort((a, b) => {
    const ia = BALANCE_PREFERENCE.indexOf(a.balance_type);
    const ib = BALANCE_PREFERENCE.indexOf(b.balance_type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const best = sorted[0];
  try {
    return {
      amount: decimalToCents(best.balance_amount.amount),
      date: best.last_change_date_time ?? best.reference_date ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Nom court de la banque à partir du nom ASPSP (« BNP Paribas » → « BNP », « Revolut Bank UAB » → « Revolut »). */
export function bankLabel(aspspName: string): string {
  const known: [RegExp, string][] = [
    [/bnp/i, 'BNP'],
    [/revolut/i, 'Revolut'],
    [/soci[ée]t[ée] g[ée]n[ée]rale/i, 'Société Générale'],
    [/cr[ée]dit agricole/i, 'Crédit Agricole'],
    [/cr[ée]dit mutuel/i, 'Crédit Mutuel'],
    [/caisse d.?[ée]pargne/i, 'Caisse d’Épargne'],
    [/banque populaire/i, 'Banque Populaire'],
    [/la banque postale/i, 'La Banque Postale'],
    [/boursorama|boursobank/i, 'BoursoBank'],
    [/trade republic/i, 'Trade Republic'],
  ];
  for (const [re, label] of known) if (re.test(aspspName)) return label;
  return aspspName.replace(/\s+(S\.?A\.?|SA|AG|GmbH|UAB|N\.?V\.?|plc|Bank)$/i, '').trim() || aspspName;
}

/** Type de compte d'après cash_account_type (ISO 20022 : CACC courant, SVGS épargne, CARD carte). */
export function accountKind(cashAccountType: string | undefined | null): AccountKind {
  switch ((cashAccountType ?? '').toUpperCase()) {
    case 'SVGS':
    case 'LLSV':
    case 'ONDP':
    case 'MOMA':
      return 'savings';
    case 'CARD':
      return 'card';
    case 'CACC':
    case 'TRAN':
    case 'CASH':
    case '':
      return 'current';
    default:
      return 'other';
  }
}

export function mapEbAccount(acc: EbSessionAccount, aspspName: string, connectionId: string): Account {
  const iban = acc.account_id?.iban ? acc.account_id.iban.replace(/\s+/g, '').toUpperCase() : null;
  const bank = bankLabel(aspspName);
  const suffix = iban ? ` ••${iban.slice(-4)}` : '';
  return {
    id: `eb:${acc.identification_hash}`,
    name: clean(acc.details) || clean(acc.product) || `${bank}${suffix}`,
    bank,
    iban,
    currency: acc.currency || 'EUR',
    source: 'enablebanking',
    connectionId,
    remoteUid: acc.uid ?? null,
    balance: null,
    balanceDate: null,
    lastSyncAt: null,
    lastSyncError: null,
    hidden: false,
    kind: accountKind(acc.cash_account_type),
    nickname: null,
  };
}
