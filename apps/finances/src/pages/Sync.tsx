import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { updateSettings } from '../db/seed';
import type { Account, Connection } from '../db/types';
import { useSettings } from '../hooks';
import { formatDateTime, relativeTime } from '../ui/relative';
import { formatShort } from '../lib/dates';
import { normalizeText } from '../lib/text';
import { callbackUrl, completeBankConnection, disconnectBank, parseCallback, startBankConnection } from '../sync/connect';
import { ebClientFor, type BridgeStatus, type EbClient } from '../sync/ebClient';
import { useCloud } from '../sync/cloud';
import type { EbAspsp } from '../sync/ebTypes';
import { runSync, useSyncState } from '../sync/store';
import { Badge, Button, Card, deferred, Disclosure, EmptyState, Group, Icon, Money, Reveal, Row, Segmented, SectionTitle, SelectField, Sheet, Tap, TextField, toast } from '../ui/index';
import { Screen } from '../ui/Screen';
import { useToClassifyCount } from '../domain/unclassified';

export const COUNTRIES = [
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'ES', label: 'Espagne' },
  { value: 'IT', label: 'Italie' },
  { value: 'NL', label: 'Pays-Bas' },
  { value: 'LU', label: 'Luxembourg' },
  { value: 'PT', label: 'Portugal' },
  { value: 'AT', label: 'Autriche' },
  { value: 'IE', label: 'Irlande' },
  { value: 'LT', label: 'Lituanie (Revolut)' },
  { value: 'FI', label: 'Finlande' },
] as const;

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
    if (!status.reachable) badge = <Badge tone="danger">Injoignable</Badge>;
    else if (!status.configured) badge = <Badge tone="warning">Non configuré</Badge>;
    else if (!status.authenticated) badge = <Badge tone="warning">Mot de passe requis</Badge>;
    else badge = <Badge tone="success">Prêt</Badge>;
  }
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="t-headline">Relais Enable Banking</p>
        {badge}
      </div>
      <p className="t-small mt-1 text-secondary">Ton téléphone ne contacte jamais ta banque directement : le relais (ta fonction serverless) signe les requêtes et te renvoie les opérations. Rien n’y est stocké.</p>
      {status?.authenticated && !settings.bridgePassword && <p className="t-small mt-2 text-success">Accès autorisé par ton compte MyLife : aucun mot de passe à saisir.</p>}
      {status?.reachable && !status.authenticated && <p className="t-small mt-2 text-secondary">Le plus simple : connecte-toi à ton compte MyLife (Réglages → Compte MyLife). Sinon, saisis le mot de passe du relais.</p>}
      {status && !status.reachable && <p className="t-small mt-2 text-danger">{status.error}</p>}
      {status?.reachable && !status.configured && (
        <p className="t-small mt-2 text-warning">
          Le relais n’est pas encore relié à Enable Banking. Sur l’ordinateur où se trouve le projet, lance <code>npm run setup</code> : il indique quoi créer sur enablebanking.com et termine la configuration. Les cours des placements fonctionnent déjà.
        </p>
      )}
      {status?.reachable && (status.configured || !settings.bridgePassword) && !status.authenticated && (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="min-w-0 flex-1">
            <TextField label="Mot de passe du relais" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
          </div>
          <Button type="submit" disabled={!password.trim()}>
            Valider
          </Button>
        </form>
      )}
      {settings.bridgePassword && status?.authenticated && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => void updateSettings({ bridgePassword: '' }).then(onRefresh)}>
          Oublier le mot de passe sur cet appareil
        </Button>
      )}
    </Card>
  );
}

/**
 * Pour les proches : Enable Banking (accès gratuit « restreint ») ne lit que les comptes liés à
 * l'application qui fait la demande. Chacun crée donc la sienne ; le relais la scelle pour son compte MyLife.
 */
function OwnAppCard({ client, onChange }: { client: EbClient; onChange: () => void }) {
  const settings = useSettings();
  const cloud = useCloud();
  const [appId, setAppId] = useState('');
  const [pem, setPem] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = settings.ebOwnApp ?? null;
  if (!cloud.session) return null;

  const save = async () => {
    if (!pem) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.sealCredentials(appId.trim(), pem.text);
      await updateSettings({ ebOwnApp: { sealed: r.sealed, appId: appId.trim(), name: r.name } });
      setAppId('');
      setPem(null);
      toast({ message: 'Ton application Enable Banking est enregistrée', tone: 'gold' });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Disclosure title="Ma propre application Enable Banking" summary={own ? own.name || `${own.appId.slice(0, 8)}…` : 'Pour utiliser tes propres banques'} initiallyOpen={false}>
      <Card>
        {own ? (
          <>
            <p className="t-small text-secondary">
              Tes banques passent par <strong className="font-semibold text-ink">{own.name || 'ton application'}</strong> ({own.appId.slice(0, 8)}…). La clé privée est scellée par le relais : ni cet appareil ni le serveur de synchro ne peuvent la lire.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() =>
                void updateSettings({ ebOwnApp: null }).then(() => {
                  onChange();
                  toast({ message: 'Application retirée : retour à celle du relais' });
                })
              }
            >
              Revenir à l’application du relais
            </Button>
          </>
        ) : (
          <>
            <p className="t-small text-secondary">Si ce relais appartient à quelqu’un d’autre, Enable Banking ne te laissera lire que les comptes liés à ta propre application (gratuite) :</p>
            <ol className="t-small mt-2 list-decimal space-y-1 pl-5 text-secondary">
              <li>Sur enablebanking.com, crée une application « Production ».</li>
              <li>
                Dans « Redirect URLs », ajoute <code className="break-all text-ink">{callbackUrl()}</code>
              </li>
              <li>Garde le fichier .pem téléchargé à la création.</li>
              <li>« Link accounts » : lie tes banques à l’application.</li>
              <li>Renseigne-la ici :</li>
            </ol>
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <TextField label="Identifiant de l’application" value={appId} onChange={setAppId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              <label className="glass flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-4 py-2.5">
                <Icon name="lock" className="text-accent" />
                <span className="t-body min-w-0 flex-1 truncate">{pem ? pem.name : 'Choisir la clé privée (.pem)'}</span>
                <input
                  type="file"
                  accept=".pem,application/x-pem-file,text/plain"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void f.text().then((text) => setPem({ name: f.name, text }));
                  }}
                />
              </label>
              {error && <p className="t-small text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy || !pem || appId.trim().length < 36}>
                {busy ? 'Vérification auprès d’Enable Banking…' : 'Vérifier et enregistrer'}
              </Button>
              <p className="t-caption text-muted">La clé ne reste pas sur l’appareil : le relais la vérifie, la chiffre pour ton seul compte et ne renvoie qu’un bloc scellé.</p>
            </form>
          </>
        )}
      </Card>
    </Disclosure>
  );
}

const ACCOUNT_ROLES = [
  { value: 'current', label: 'Quotidien' },
  { value: 'savings', label: 'Épargne' },
] as const;

function AccountRow({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  // Ce que la banque a réellement transmis : la date de la dernière opération reçue et celles encore « en cours ».
  const received = useLiveQuery(async () => {
    const list = await db.transactions.where('accountId').equals(account.id).toArray();
    return { last: list.reduce<string | null>((m, t) => (m === null || t.date > m ? t.date : m), null), pending: list.filter((t) => t.pending).length };
  }, [account.id]);
  const role = account.kind === 'savings' ? 'savings' : 'current';
  return (
    <>
      <Sheet open={open} onClose={() => setOpen(false)} title={account.nickname ?? account.name}>
        <p className="t-small mb-3 text-secondary">
          Un compte « Quotidien » compte dans ton argent réellement disponible (budget du jour, prévision). Un compte « Épargne » (livret, cash mis de côté, compte d’un courtier) n’y compte pas : les virements vers lui sont de l’épargne.
        </p>
        <Segmented options={ACCOUNT_ROLES} value={role} onChange={(kind) => void db.accounts.update(account.id, { kind })} label="Rôle du compte" />
      </Sheet>
      <Row
        onClick={() => setOpen(true)}
        chevron
        icon={account.kind === 'savings' ? 'leaf' : 'card'}
        title={account.nickname ?? account.name}
        subtitle={
          <>
            {account.kind === 'savings' ? 'Épargne · ' : ''}
            {account.iban ? `••${account.iban.slice(-4)} · ` : ''}synchro {relativeTime(account.lastSyncAt)}
            {received?.last && (
              <span className="block">
                dernière opération reçue : {formatShort(received.last)}
                {received.pending > 0 ? ` · ${received.pending} en cours` : ''}
              </span>
            )}
            {account.lastSyncError && <span className="block text-danger">{account.lastSyncError}</span>}
          </>
        }
        right={account.balance !== null ? <Money cents={account.balance} /> : undefined}
      />
    </>
  );
}

function ConnectionCard({ connection, accounts, client, onReconnect }: { connection: Connection; accounts: Account[]; client: EbClient | null; onReconnect: () => void }) {
  const expired = connection.status !== 'active';
  const daysLeft = Math.ceil((new Date(connection.validUntil).getTime() - Date.now()) / 86400_000);
  return (
    <div>
      <SectionTitle
        action={
          expired ? (
            <Badge tone="danger">{connection.status === 'revoked' ? 'Déconnectée' : 'Expirée'}</Badge>
          ) : daysLeft <= 14 ? (
            <Badge tone="warning">Expire dans {daysLeft} j</Badge>
          ) : (
            <Badge tone="success">Active</Badge>
          )
        }
      >
        {connection.aspspName}
      </SectionTitle>
      <Group>
        {accounts.map((a) => (
          <AccountRow key={a.id} account={a} />
        ))}
      </Group>
      <p className="t-caption mt-2 px-0.5 text-muted">Accès valable jusqu’au {formatDateTime(connection.validUntil)}.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(expired || daysLeft <= 14) && (
          <Button size="sm" onClick={onReconnect} disabled={!client}>
            Reconnecter
          </Button>
        )}
        {!expired && (
          <Button size="sm" variant="danger" onClick={() => deferred(`${connection.aspspName} sera déconnectée`, () => disconnectBank(client, connection.id))}>
            Déconnecter
          </Button>
        )}
      </div>
    </div>
  );
}

function BankPicker({ client, open, onClose }: { client: EbClient | null; open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const [country, setCountry] = useState(settings.bankCountry);
  const [aspsps, setAspsps] = useState<EbAspsp[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setAspsps(null);
    setError(null);
    try {
      setAspsps(await client.aspsps(country));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [client, country]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

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

  const filtered = useMemo(() => {
    if (!aspsps) return [];
    const q = normalizeText(query);
    return aspsps.filter((a) => !q || normalizeText(a.name).includes(q)).slice(0, 60);
  }, [aspsps, query]);

  return (
    <Sheet open={open} onClose={onClose} title="Ajouter une banque">
      <div className="space-y-3">
        <SelectField
          label="Pays de la banque"
          value={country}
          onChange={(v) => {
            setCountry(v);
            void updateSettings({ bankCountry: v });
          }}
          options={COUNTRIES}
        />
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field-input pl-10" placeholder="Nom de la banque" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher une banque" />
        </div>
        {error && <p className="t-small text-danger">{error}</p>}
        {!aspsps && !error && <p className="t-small text-muted">Chargement de la liste…</p>}
        <div className="-mx-2">
          {filtered.map((a) => (
            <Tap key={a.name + a.country} disabled={!!busy} onClick={() => void connect(a)} className="flex min-h-[52px] w-full items-center gap-3 rounded-md px-3 text-left">
              <Icon name="bank" className="text-secondary" />
              <span className="t-body-strong min-w-0 flex-1 truncate">{a.name}</span>
              {a.beta && <Badge>bêta</Badge>}
              {busy === a.name ? <span className="t-caption text-accent">Redirection…</span> : <Icon name="chevron-forward" size={17} className="text-muted" />}
            </Tap>
          ))}
          {aspsps && filtered.length === 0 && <p className="t-small px-2 text-muted">Aucune banque trouvée. Essaie un autre pays : certaines néobanques sont listées dans leur pays d’origine.</p>}
        </div>
        <p className="t-caption text-muted">Tu seras redirigé vers ta banque pour autoriser un accès en lecture seule (soldes et opérations), valable 90 à 180 jours.</p>
      </div>
    </Sheet>
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
    <Disclosure title="La banque m’a renvoyé dans le navigateur">
      <Card>
        <p className="t-small text-secondary">Sur iPhone, l’app installée et Safari ne partagent pas leurs données. Copie le lien de la page de retour et colle-le ici.</p>
        <div className="mt-3 flex gap-2">
          <input className="field-input" placeholder="https://…/connexion/retour?code=…" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Lien de retour" />
          <Button onClick={() => void submit()} disabled={!value || !client}>
            OK
          </Button>
        </div>
        {msg && <p className={`t-small mt-2 ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>}
      </Card>
    </Disclosure>
  );
}

export default function SyncPage() {
  const settings = useSettings();
  const sync = useSyncState();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [tick, setTick] = useState(0);
  const [picker, setPicker] = useState(false);
  const connections = useLiveQuery(() => db.connections.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.where('source').equals('enablebanking').toArray(), []) ?? [];
  const toClassify = useToClassifyCount();

  const sealed = settings.ebOwnApp?.sealed;
  const probeClient = useMemo(() => ebClientFor({ bridgePassword: settings.bridgePassword, ebOwnApp: sealed ? { sealed } : null }), [settings.bridgePassword, sealed]);
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
      toast({ message: (e as Error).message, tone: 'danger' });
    }
  };

  return (
    <Screen
      stack
      title="Banques"
      kicker="Synchronisation via Enable Banking"
      mood="settings"
      footer={
        accounts.length > 0 ? (
          <Button size="lg" className="w-full" icon="sync" disabled={sync.syncing || !client} onClick={() => void runSync()}>
            {sync.syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
          </Button>
        ) : undefined
      }
    >
      <Reveal index={0}>
        <BridgeCard status={status} onRefresh={() => setTick((t) => t + 1)} />
        <OwnAppCard client={probeClient} onChange={() => setTick((t) => t + 1)} />
      </Reveal>

      {sync.error && (
        <Card tone="danger" className="mt-3">
          <p className="t-small text-danger">{sync.error}</p>
        </Card>
      )}
      {sync.reports && (
        <Card className="mt-3">
          <p className="t-label mb-2 text-muted">Dernière synchro</p>
          <ul className="space-y-1">
            {sync.reports.map((r) => (
              <li key={r.accountId} className="t-small">
                <span className="font-semibold">{r.accountName}</span> :{' '}
                {r.error ? (
                  <span className="text-danger">{r.error}</span>
                ) : (
                  <span className="text-secondary">
                    {r.added} nouvelle(s), {r.duplicates} déjà connue(s), {r.pending} en attente{r.settled ? `, ${r.settled} validée(s)` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {toClassify > 0 && (
        <Card to="/a-classer" tone="warning" className="mt-3 flex items-center gap-3">
          <Icon name="tag" className="text-warning" />
          <span className="t-body flex-1">
            <strong className="font-semibold">{toClassify}</strong> opération(s) à classer
          </span>
          <Icon name="chevron-forward" size={17} className="text-muted" />
        </Card>
      )}

      <Reveal index={1}>
        {visibleConnections.length === 0 && accounts.length === 0 ? (
          <Card className="mt-4">
            <EmptyState icon="bank" title="Aucune banque connectée" body="Ajoute tes banques une par une : compte courant, néobanque, livret… Tu valides l’accès en lecture seule sur le site de ta banque." />
          </Card>
        ) : (
          visibleConnections.map((c) => <ConnectionCard key={c.id} connection={c} accounts={accounts.filter((a) => a.connectionId === c.id)} client={client} onReconnect={() => void reconnect(c)} />)
        )}
        <div className="mt-4">
          <Button variant="secondary" icon="add" className="w-full" disabled={!client} onClick={() => setPicker(true)}>
            Ajouter une banque
          </Button>
          {!client && <p className="t-caption mt-2 px-0.5 text-muted">Configure d’abord le relais ci-dessus.</p>}
        </div>
        <PasteCallback client={client} />
      </Reveal>
      <BankPicker client={client} open={picker} onClose={() => setPicker(false)} />
    </Screen>
  );
}
