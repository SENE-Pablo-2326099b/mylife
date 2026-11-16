import { useState } from 'react';
import { Button, Field, Icon, List, ListRow, ModuleCard, Notice, Panel, ScreenHeader, SectionTitle, type IconName } from '@mylife/kit';
import { currentSession, webPlatform } from '@mylife/core/web';
import { readThemeChoice } from '@mylife/kit';
import { buildRetiredArchive } from '../archive';

/**
 * Tes données : les voir, les emporter, les effacer. L’export de la coquille est encore mince (réglages) : chaque
 * module reconstruit y ajoutera le sien par le contrat (phase 3). L’archive des fonctions retirées en V5 reste là
 * tant que le serveur garde leurs données.
 */
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const LINKS: { href: string; icon: IconName; title: string; detail: string }[] = [
  { href: '/argent/reglages', icon: 'card', title: 'MyFinances', detail: 'Réglages → Banques et données → Exporter mes données' },
  { href: '/perf/settings', icon: 'barbell', title: 'MyPerf', detail: 'Réglages → Exporter mes données' },
];

const KINDS = [
  { value: 'bug', label: 'Un problème' },
  { value: 'idee', label: 'Une idée' },
  { value: 'question', label: 'Une question' },
  { value: 'donnees', label: 'Mes données (RGPD)' },
] as const;

/** « Un problème, une idée ? » : un message à l’équipe (non chiffré, et c’est dit). */
export function SupportCard() {
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    const s = currentSession();
    if (!s) return;
    setBusy(true);
    setStatus(null);
    try {
      await webPlatform.api.call('/api/support', { action: 'send', kind, message: message.trim(), app: 'home' }, s.token);
      setMessage('');
      setStatus({ ok: true, text: 'Message envoyé : merci !' });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Un problème, une idée ?">
      <Field id="support-kind" label="C’est…">
        <select id="support-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="support-message" label="Ton message" hint="Ce message n’est pas chiffré : l’équipe MyLife pourra le lire. N’y mets pas de données sensibles. Effacé une fois traité (90 jours au plus).">
        <textarea id="support-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Raconte-nous" rows={4} />
      </Field>
      {status && <Notice tone={status.ok ? 'ok' : 'bad'}>{status.text}</Notice>}
      <Button disabled={busy || message.trim().length < 3} onClick={() => void send()}>
        {busy ? 'Envoi…' : 'Envoyer'}
      </Button>
    </Panel>
  );
}

export function DataPage() {
  const [archiving, setArchiving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const exportMine = () => {
    download(`mylife-${new Date().toISOString().slice(0, 10)}.json`, { format: 'mylife-export', exportedAt: new Date().toISOString(), account: currentSession()?.login ?? null, theme: readThemeChoice() });
    setNote('Export téléchargé.');
  };
  const exportRetired = async () => {
    setArchiving(true);
    try {
      const archive = await buildRetiredArchive();
      download(`mylife-archive-${new Date().toISOString().slice(0, 10)}.json`, archive);
      const failed = Object.keys(archive.errors).length;
      setNote(failed ? `Archive téléchargée, sans ${failed} partie${failed > 1 ? 's' : ''} illisible${failed > 1 ? 's' : ''} pour l’instant (réessaie en ligne).` : 'Archive téléchargée.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setArchiving(false);
    }
  };
  return (
    <>
      <ScreenHeader kicker="Les voir, les emporter, les effacer" title="Tes données" />
      <ModuleCard tone="neutral">
        <div className="pad stack">
          <span className="t-card">Ce que MyLife sait de toi</span>
          <span className="t-small muted">Tes réglages communs. Chaque module ajoutera son export ici au fil de sa reconstruction ; en attendant, il s’exporte depuis le module.</span>
          <Button variant="action" block onClick={exportMine}>
            Exporter
          </Button>
          {note && <Notice tone="ok">{note}</Notice>}
        </div>
      </ModuleCard>
      <SectionTitle>Dans chaque module</SectionTitle>
      <List>
        {LINKS.map((l) => (
          <ListRow key={l.href} href={l.href} lead={<Icon name={l.icon} size={20} />} title={l.title} detail={l.detail} />
        ))}
      </List>
      <Panel title="Les fonctions retirées">
        <span className="t-small muted">Personnage, bilans, Crew, MyMusique, MyGames, Mes apps, MyObjectifs, MyAgenda, MyFoyer et MyChef ne sont plus dans MyLife. Leurs données restent dans ton compte encore un temps, puis seront effacées : emporte-les ici, lues et déchiffrées sur ton appareil.</span>
        <Button disabled={archiving} onClick={() => void exportRetired()}>
          {archiving ? 'Lecture du compte…' : "Télécharger l’archive"}
        </Button>
      </Panel>
      <Panel title="Tout effacer">
        <span className="t-small muted">Compte → « Supprimer mon compte » : tout ce que le serveur garde est effacé, pour toutes les apps, tout de suite.</span>
        <Button href="/compte">Aller au compte</Button>
      </Panel>
      <SupportCard />
      <a href="/confidentialite" className="link link-quiet t-small" style={{ alignSelf: 'center', padding: '8px 0' }}>
        Ce que MyLife garde, et pourquoi
      </a>
    </>
  );
}
