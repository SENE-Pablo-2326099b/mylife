import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Field, Money, PageTitle, inputClass } from '../components/ui';
import { IconBank, IconSync } from '../components/icons';
import { db } from '../db/db';
import { updateSettings } from '../db/seed';
import type { Account, Connection } from '../db/types';
import { useSettings } from '../hooks';
import { formatDateTime, relativeTime } from '../lib/relative';
import { normalizeText } from '../lib/text';
import { completeBankConnection, disconnectBank, findAspsp, parseCallback, startBankConnection } from '../sync/connect';
import { EbClient, type BridgeStatus } from '../sync/ebClient';
import type { EbAspsp } from '../sync/ebTypes';
import { runSync, useSyncState } from '../sync/store';

function BridgeCard({ status, onRefresh }: { status: BridgeStatus | null; onRefresh: () => void }) {
  const settings = useSettings();
  const [password, setPassword] = useState('');
  const save = async () => {
    await updateSettings({ bridgePassword: password.trim() });
    setPassword('');
    onRefresh();
  };
  let badge = <Badge>Vérification…</Badge>;
  if (status) {
    if (!status.reachable) badge = <Badge tone="bad">Injoignable</Badge>;
    else if (!status.configured) badge = <Badge tone="warn">Non configuré</Badge>;
    else if (!status.authenticated) badge = <Badge tone="warn">Mot de passe requis</Badge>;
    else badge = <Badge tone="good">Prêt</Badge>;
  }
  return (
    <Card title="Relais Enable Banking" action={badge}>
      <p className="text-sm text-muted">
        Les banques ne sont jamais contactées directement par ton téléphone : le relais (ta fonction serverless) signe les requêtes avec ta clé
        Enable Banking et te renvoie les opérations. Rien n’y est stocké.
      </p>
      {status && !status.reachable && <p className="mt-2 text-sm text-bad">{status.error}</p>}
      {status?.reachable && !status.configured && (
        <p className="mt-2 text-sm text-warn">
          {status.error ?? 'Variables EB_APP_ID / EB_PRIVATE_KEY manquantes.'} Voir le README, section « Configurer Enable Banking ».
        </p>
      )}
      {status?.reachable && status.configured && !status.authenticated && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Mot de passe du relais (BRIDGE_PASSWORD)">
            {(id) => <input id={id} type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" className="self-end">
            Valider
          </Button>
        </form>
      )}
      {settings.bridgePassword && status?.authenticated && (
        <button className="mt-2 text-xs text-muted underline" onClick={() => void updateSettings({ bridgePassword: '' }).then(onRefresh)}>
          Oublier le mot de passe sur cet appareil
        </button>
      )}
    </Card>
  );
}

function AccountRow({ account }: { account: Account }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {account.bank} · {account.name}
        </p>
        <p className="text-xs text-muted">
          {account.iban ? `••${account.iban.slice(-4)} · ` : ''}synchro {relativeTime(account.lastSyncAt)}
        </p>
        {account.lastSyncError && <p className="text-xs text-bad">{account.lastSyncError}</p>}
      </div>
      {account.balance !== null && <Money cents={account.balance} className="font-semibold" />}
    </li>
  );
}

function ConnectionCard({ connection, accounts, client, onReconnect }: { connection: Connection; accounts: Account[]; client: EbClient | null; onReconnect: () => void }) {
  const expired = connection.status !== 'active';
  const daysLeft = Math.ceil((new Date(connection.validUntil).getTime() - Date.now()) / 86400_000);
  return (
    <Card
      title={connection.aspspName}
      action={
        expired ? (
          <Badge tone="bad">{connection.status === 'revoked' ? 'Déconnectée' : 'Expirée'}</Badge>
        ) : daysLeft <= 14 ? (
          <Badge tone="warn">Expire dans {daysLeft} j</Badge>
        ) : (
          <Badge tone="good">Active</Badge>
        )
      }
    >
      <ul className="divide-y divide-line/60">
        {accounts.map((a) => (
          <AccountRow key={a.id} account={a} />
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Accès valable jusqu’au {formatDateTime(connection.validUntil)}.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(expired || daysLeft <= 14) && (
          <Button variant="primary" onClick={onReconnect} disabled={!client}>
            Reconnecter
          </Button>
        )}
        {!expired && (
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(`Déconnecter ${connection.aspspName} ? L’historique déjà synchronisé est conservé.`)) void disconnectBank(client, connection.id);
            }}
          >
            Déconnecter
          </Button>
        )}
      </div>
    </Card>
  );
}

function AddBank({ client }: { client: EbClient | null }) {
  const [aspsps, setAspsps] = useState<EbAspsp[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return null;
    try {
      const list = await client.aspsps('FR');
      setAspsps(list);
      return list;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [client]);

  const connect = async (aspsp: EbAspsp) => {
    if (!client) return;
    setBusy(aspsp.name);
    setError(null);
    try {
      await startBankConnection(client, aspsp);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const quick = async (pattern: RegExp, label: string) => {
    setBusy(label);
    setError(null);
    const list = aspsps ?? (await load());
    const found = list && findAspsp(list, pattern);
    if (!found) {
      setBusy(null);
      if (list) setError(`${label} introuvable dans la liste Enable Banking : cherche-la ci-dessous.`);
      return;
    }
    await connect(found);
  };

  const filtered = useMemo(() => {
    if (!aspsps) return [];
    const q = normalizeText(query);
    return aspsps.filter((a) => !q || normalizeText(a.name).includes(q)).slice(0, 30);
  }, [aspsps, query]);

  return (
    <Card title="Ajouter une banque">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" disabled={!client || !!busy} onClick={() => void quick(/^bnp paribas$|bnp paribas/i, 'BNP Paribas')}>
          <IconBank size={18} /> {busy === 'BNP Paribas' ? 'Redirection…' : 'BNP Paribas'}
        </Button>
        <Button variant="ghost" disabled={!client || !!busy} onClick={() => void quick(/revolut/i, 'Revolut')}>
          <IconBank size={18} /> {busy === 'Revolut' ? 'Redirection…' : 'Revolut'}
        </Button>
      </div>
      {!client && <p className="mt-2 text-xs text-muted">Configure d’abord le relais ci-dessus.</p>}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <details className="mt-3" onToggle={(e) => (e.target as HTMLDetailsElement).open && !aspsps && void load()}>
        <summary className="cursor-pointer text-sm text-muted">Autre banque…</summary>
        <input className={`${inputClass} mt-2`} placeholder="Rechercher une banque" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher une banque" />
        <ul className="mt-2 max-h-64 overflow-auto">
          {filtered.map((a) => (
            <li key={a.name + a.country}>
              <button className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-2 text-left hover:bg-raised" disabled={!!busy} onClick={() => void connect(a)}>
                <span>{a.name}</span>
                {a.beta && <Badge>bêta</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function PasteCallback({ client }: { client: EbClient | null }) {
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async () => {
    if (!client) return;
    const { code, state, error } = parseCallback(value);
    if (error || !code) return setMsg({ ok: false, text: error ?? 'Lien invalide : aucun code trouvé.' });
    try {
      const accounts = await completeBankConnection(client, code, state);
      setMsg({ ok: true, text: `${accounts.length} compte(s) connecté(s).` });
      setValue('');
      void runSync();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <details className="rounded-2xl border border-line/60 bg-surface p-4">
      <summary className="cursor-pointer text-sm text-muted">La banque m’a renvoyé dans le navigateur au lieu de l’app</summary>
      <p className="mt-2 text-sm text-muted">Sur iPhone, l’app installée et Safari ne partagent pas leurs données. Copie le lien de la page de retour et colle-le ici.</p>
      <div className="mt-2 flex gap-2">
        <input className={inputClass} placeholder="https://…/connexion/retour?code=…" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Lien de retour" />
        <Button variant="primary" onClick={() => void submit()} disabled={!value || !client}>
          OK
        </Button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-good' : 'text-bad'}`}>{msg.text}</p>}
    </details>
  );
}

export default function SyncPage() {
  const settings = useSettings();
  const sync = useSyncState();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [tick, setTick] = useState(0);
  const connections = useLiveQuery(() => db.connections.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.where('source').equals('enablebanking').toArray(), []) ?? [];
  const toClassify = useLiveQuery(() => db.transactions.filter((t) => t.categoryId === null).count(), []) ?? 0;

  const probeClient = useMemo(() => new EbClient(settings.bridgePassword), [settings.bridgePassword]);
  const client = status?.authenticated && status.configured ? probeClient : null;

  useEffect(() => {
    let alive = true;
    setStatus(null);
    void probeClient.status().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [probeClient, tick]);

  const visibleConnections = connections.filter((c) => c.status !== 'revoked' || accounts.some((a) => a.connectionId === c.id && a.remoteUid));
  const reconnect = async (c: Connection) => {
    if (!client) return;
    try {
      await startBankConnection(client, { name: c.aspspName, country: c.aspspCountry });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle sub="Tes comptes BNP et Revolut via Enable Banking">Synchronisation</PageTitle>

      <BridgeCard status={status} onRefresh={() => setTick((t) => t + 1)} />

      {accounts.length > 0 && (
        <div className="flex items-center gap-3">
          <Button variant="primary" className="flex-1" disabled={sync.syncing || !client} onClick={() => void runSync()}>
            <IconSync size={18} className={sync.syncing ? 'animate-spin' : ''} />
            {sync.syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
          </Button>
        </div>
      )}

      {sync.error && <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{sync.error}</p>}
      {sync.reports && (
        <Card title="Dernière synchro">
          <ul className="space-y-1 text-sm">
            {sync.reports.map((r) => (
              <li key={r.accountId}>
                <span className="font-medium">{r.accountName}</span> :{' '}
                {r.error ? (
                  <span className="text-bad">{r.error}</span>
                ) : (
                  <span className="text-muted">
                    {r.added} nouvelle(s), {r.duplicates} déjà connue(s), {r.pending} en attente{r.settled ? `, ${r.settled} validée(s)` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {toClassify > 0 && (
        <Link to="/a-classer" className="block rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <strong>{toClassify} opération(s) à classer</strong> — trier maintenant →
        </Link>
      )}

      {visibleConnections.length === 0 && accounts.length === 0 ? (
        <EmptyState title="Aucune banque connectée">Ajoute BNP Paribas puis Revolut ci-dessous. Tu seras redirigé vers ta banque pour valider l’accès en lecture seule.</EmptyState>
      ) : (
        visibleConnections.map((c) => (
          <ConnectionCard key={c.id} connection={c} accounts={accounts.filter((a) => a.connectionId === c.id)} client={client} onReconnect={() => void reconnect(c)} />
        ))
      )}

      <AddBank client={client} />
      <PasteCallback client={client} />
    </div>
  );
}
