/** Sous-ensemble des schémas de l'API Enable Banking utilisés par l'app. */

export interface EbAmount {
  currency: string;
  amount: string;
}

export interface EbParty {
  name?: string | null;
}

export interface EbAccountRef {
  iban?: string | null;
  other?: { identification?: string; scheme_name?: string } | null;
}

export type EbTransactionStatus = 'BOOK' | 'CNCL' | 'HOLD' | 'OTHR' | 'PDNG' | 'RJCT' | 'SCHD';

export interface EbTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  merchant_category_code?: string | null;
  transaction_amount: EbAmount;
  creditor?: EbParty | null;
  creditor_account?: EbAccountRef | null;
  debtor?: EbParty | null;
  debtor_account?: EbAccountRef | null;
  bank_transaction_code?: { description?: string | null; code?: string | null; sub_code?: string | null } | null;
  credit_debit_indicator?: 'CRDT' | 'DBIT' | null;
  status?: EbTransactionStatus | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  balance_after_transaction?: EbAmount | null;
  reference_number?: string | null;
  remittance_information?: string[] | null;
  note?: string | null;
}

export interface EbTransactionsPage {
  transactions: EbTransaction[];
  continuation_key?: string | null;
}

export interface EbBalance {
  name: string;
  balance_amount: EbAmount;
  balance_type: string;
  reference_date?: string | null;
  last_change_date_time?: string | null;
}

export interface EbSessionAccount {
  uid?: string | null;
  account_id?: EbAccountRef | null;
  name?: string | null;
  details?: string | null;
  product?: string | null;
  currency: string;
  cash_account_type?: string;
  identification_hash: string;
}

export interface EbSession {
  session_id: string;
  accounts: EbSessionAccount[];
  aspsp: { name: string; country: string };
  access: { valid_until: string };
}

export interface EbAspsp {
  name: string;
  country: string;
  logo?: string;
  maximum_consent_validity?: number;
  beta?: boolean;
  psu_types?: string[];
}

export interface EbStartAuthResponse {
  url: string;
  authorization_id: string;
}

export interface EbGetSessionResponse {
  status: string;
  accounts: string[];
  accounts_data?: { uid: string; identification_hash: string }[];
  aspsp: { name: string; country: string };
  access: { valid_until: string };
}
