import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Field, Glass, List, ListRow, Notice, ScreenHeader, SectionTitle } from '@mylife/kit';
import { completeBankConnection, disconnectBank, parseCallback, startBankConnection } from '../bank/connect';
import type { EbAspsp } from '../bank/ebTypes';
import { canUseRelay, Relay } from '../bank/relay';
import { runBankSync, useBankState } from '../bank/sync';
import { euros } from '../core/format';
import { normalizeText } from '../core/text';
import { resolveChoice, syncCloud, useCloud } from '../data/cloud';
import { bankSettings, facts, getMeta, type RawConnection } from '../data/facts';
import '../finances.css';

/**
 * Les banques : ce qui est relié, jusqu'à quand, la synchro à la demande, relier une banque de plus. Et, en dessous,
 * l'état de la synchro entre les appareils du compte.
 */
const when = (t: number | null | undefined) => (t ? new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais');
const until = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const STATUS: Record<RawConnection['status'], string> = { active: 'active', expired: 'expirée', revoked: 'fermée', error: 'en erreur' };

/** Le choix à faire quand l'appareil et le compte ont chacun des données. Montré aussi sur les écrans du module. */
export function CloudNotice() {
  const cloud = useCloud();
  if (cloud.choice)
    return (
      <Notice tone="warn">
        <span className="stack" style={{ gap: 10 }}>
          <span>
            {cloud.choice.part === 'state' ? 'Cet appareil et ton compte ont chacun des réglages MyFinances.' : 'Cet appareil et ton compte ont chacun des données MyFinances.'} Lesquels garder ?
            {cloud.choice.lastUpdated ? ` Ceux du compte datent du ${when(cloud.choice.lastUpdated)}.` : ''}
          </span>
          <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={() => void resolveChoice('useDevice')} disabled={cloud.syncing}>
              Ceux de cet appareil
            </Button>
            <Button onClick={() => void resolveChoice('useAccount')} disabled={cloud.syncing}>
              Ceux du compte
            </Button>
          </span>
        </span>
      </Notice>
    );
  return cloud.error ? <Notice tone="bad">Synchro entre appareils : {cloud.error}</Notice> : null;
}

export function BanquesPage() {
  const bank = useBankState();
  const cloud = useCloud();
  const accounts = useLiveQuery(() => facts.accounts.toArray(), [], []);
  const connections = useLiveQuery(() => facts.connections.toArray(), [], []);
  const lastSync = useLiveQuery(() => getMeta<number>('lastSyncAt'), [bank.finishedAt]);
  const [relay, setRelay] = useState<Relay | null | undefined>(undefined);
  const [country, setCountry] = useState('FR');
  const [banks, setBanks] = useState<EbAspsp[] | null>(null);
  const [query, setQuery] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void bankSettings().then((s) => {
      setCountry(s.bankCountry);
      setRelay(canUseRelay(s) ? new Relay(s) : null);
    });
    void syncCloud();
  }, [cloud.signedIn]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const found = useMemo(() => {
    const words = normalizeText(query);
    return (banks ?? []).filter((b) => !words || normalizeText(b.name).includes(words)).slice(0, 30);
  }, [banks, query]);
  const live = connections.filter((c) => c.status !== 'revoked').sort((a, b) => b.createdAt - a.createdAt);
  const linked = accounts.filter((a) => a.source === 'enablebanking' && a.remoteUid);

  return (
    <div className="fin-screen tone-finances">
      <ScreenHeader kicker="MyFinances" title="Banques" right={<Button href="/argent">Retour</Button>} />
      <CloudNotice />
      {relay === null && <Notice tone="warn">Connecte-toi à ton compte MyLife pour relier et synchroniser tes banques.</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}

      <Glass className="pad stack">
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="t-card">{linked.length ? `${linked.length} compte${linked.length > 1 ? 's' : ''} relié${linked.length > 1 ? 's' : ''}` : 'Aucun compte relié'}</span>
            <span className="t-small muted">Dernière synchro : {when(lastSync)}</span>
          </span>
          <Button variant="action" disabled={!relay || bank.syncing || linked.length === 0} onClick={() => void runBankSync()}>
            {bank.syncing ? 'Synchro…' : 'Synchroniser'}
          </Button>
        </div>
        {bank.error && <Notice tone="bad">{bank.error}</Notice>}
        {bank.reports?.map((r) => (
          <span key={r.accountId} className="t-small muted">
            {r.accountName} : {r.error ?? (r.added ? `${r.added} nouvelle${r.added > 1 ? 's' : ''} opération${r.added > 1 ? 's' : ''}` : 'à jour')}
            {!r.error && r.pending ? ` · ${r.pending} en attente` : ''}
          </span>
        ))}
      </Glass>

      {live.length > 0 && <SectionTitle>Accès</SectionTitle>}
      {live.map((c) => {
        const mine = accounts.filter((a) => a.connectionId === c.id);
        const expired = c.status !== 'active' || new Date(c.validUntil).getTime() < Date.now();
        return (
          <Glass key={c.id} className="pad stack">
            <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="t-card">{c.aspspName}</span>
                <span className="t-small muted">{expired ? `Accès ${c.status === 'active' ? 'expiré' : STATUS[c.status]} : à reconnecter` : `Accès jusqu’au ${until(c.validUntil)}`}</span>
              </span>
            </div>
            <List>
              {mine.map((a) => (
                <ListRow key={a.id} title={a.nickname?.trim() || a.name} detail={a.lastSyncError ?? `synchro : ${when(a.lastSyncAt)}`} value={a.balance === null ? '?' : euros(a.balance, { round: true })} />
              ))}
            </List>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button disabled={!relay || busy} onClick={() => void run(() => startBankConnection(relay!, { name: c.aspspName, country: c.aspspCountry }))}>
                {expired ? 'Reconnecter' : 'Renouveler l’accès'}
              </Button>
              <Button disabled={busy} onClick={() => void run(() => disconnectBank(relay ?? null, c.id))}>
                Fermer l’accès
              </Button>
            </div>
          </Glass>
        );
      })}

      <SectionTitle>Relier une banque</SectionTitle>
      <Glass className="pad stack">
        <span className="t-small muted">Tu t’identifies sur le site de ta banque : MyLife ne voit jamais tes identifiants, et ne peut que lire tes opérations.</span>
        {banks === null ? (
          <Button disabled={!relay || busy} onClick={() => void run(async () => setBanks(await relay!.aspsps(country)))}>
            Voir les banques
          </Button>
        ) : (
          <>
            <Field id="bank-search" label="Ta banque">
              <input id="bank-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom de la banque" />
            </Field>
            <List>
              {found.length === 0 && <ListRow title="Aucune banque à ce nom" />}
              {found.map((b) => (
                <ListRow key={`${b.name}|${b.country}`} title={b.name} detail={b.beta ? 'en test' : undefined} onClick={() => void run(() => startBankConnection(relay!, b))} />
              ))}
            </List>
          </>
        )}
      </Glass>

      <SectionTitle>Revenu de la banque dans le navigateur ?</SectionTitle>
      <Glass className="pad stack">
        <Field id="bank-link" label="Colle ici l’adresse de la page où la banque t’a renvoyé">
          <input id="bank-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/connexion/retour?code=…" />
        </Field>
        <Button
          disabled={!relay || busy || !link.trim()}
          onClick={() =>
            void run(async () => {
              const { code, state, error: refused } = parseCallback(link);
              if (refused) throw new Error(`La banque a refusé ou annulé l’accès (${refused}).`);
              if (!code) throw new Error('Aucun code d’autorisation dans cette adresse.');
              const added = await completeBankConnection(relay!, code, state);
              setLink('');
              setDone(`${added.length} compte${added.length > 1 ? 's' : ''} relié${added.length > 1 ? 's' : ''}.`);
              await runBankSync();
            })
          }
        >
          Terminer la connexion
        </Button>
      </Glass>

      <SectionTitle>Entre tes appareils</SectionTitle>
      <Glass className="pad stack">
        <span className="t-small muted">
          {!cloud.signedIn ? 'Sans compte MyLife, tes données restent sur cet appareil.' : cloud.syncing ? 'Synchro en cours…' : `Chiffrée, à jour au ${when(cloud.lastSyncAt)}${cloud.pending ? ` · ${cloud.pending} modification${cloud.pending > 1 ? 's' : ''} à envoyer` : ''}.`}
        </span>
      </Glass>
    </div>
  );
}
