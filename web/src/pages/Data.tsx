import { useState } from 'react';
import { HOME_APPS, STATS_APPS, readStats } from '../vendor/lumen';
import { APP_EXPORTS } from '../appData';
import { currentSession, webPlatform } from '../vendor/mylife-sync/web';
import { getAppearance } from '../ui/appearance';
import { Icon, type IconName } from '../ui/icons';
import { Button, Card, Reveal, SectionTitle, SelectField, TextField } from '../ui/index';
import { Screen } from '../ui/Screen';
import { readCharacterPrefs } from '../ui/stats';
import { toast } from '../ui/toastStore';

/**
 * Mes données : emporter ce que MyLife sait de toi (export lisible), et le chemin vers l'export de chaque app,
 * la suppression du compte, la confidentialité. Et « Un problème, une idée ? » (support).
 */

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const LINKS: { to: string; icon: IconName; title: string; detail: string }[] = [
  { to: '/finances/reglages/donnees', icon: 'diamond-fill', title: 'MyFinances', detail: 'Réglages → Sauvegarde et données → Exporter' },
  { to: '/perf/settings', icon: 'barbell', title: 'MyPerf', detail: 'Réglages → Exporter mes données' },
  { to: '/perf/program-import', icon: 'list', title: 'Ton programme MyPerf', detail: 'Exporter mon programme (format d’échange)' },
];

export function DataPage() {
  const exportMine = () => {
    const session = currentSession();
    download(`mylife-${new Date().toISOString().slice(0, 10)}.json`, {
      format: 'mylife-export',
      exportedAt: new Date().toISOString(),
      account: session?.login ?? null,
      appearance: getAppearance(),
      character: readCharacterPrefs(),
      counters: Object.fromEntries(STATS_APPS.map((a) => [a, readStats(a)])),
      // Chaque app de l'accueil, selon le registre (les espaces partagés appartiennent à leur groupe).
      ...Object.fromEntries(HOME_APPS.filter((a) => a.exportable && APP_EXPORTS[a.id]).map((a) => [a.id, APP_EXPORTS[a.id]!()])),
    });
    toast({ message: 'Export téléchargé', tone: 'gold' });
  };
  return (
    <Screen stack title="Mes données" kicker="Les voir, les emporter, les effacer" mood="settings" back="/compte">
      <div className="flex flex-col gap-3">
        <Reveal index={0}>
          <Card level="raised">
            <p className="t-headline">Tout ce que l’accueil sait de toi</p>
            <p className="t-small mt-1 text-secondary">Apparence, Personnage (compteurs par semaine, semaines de repos, choix de partage), résumé d’écoute, heures de jeu, tes apps et leurs saisies. En clair, dans un fichier JSON.</p>
            <Button className="mt-3 w-full" icon="download" onClick={exportMine}>
              Exporter
            </Button>
          </Card>
        </Reveal>
        <Reveal index={1}>
          <SectionTitle>Dans chaque app</SectionTitle>
          <div className="flex flex-col gap-2">
            {LINKS.map((l) => (
              <a key={l.to} href={l.to} className="glass block rounded-lg p-4">
                <span className="flex items-center gap-3">
                  <Icon name={l.icon} className="text-gold" />
                  <span className="min-w-0 flex-1">
                    <span className="t-body-strong block">{l.title}</span>
                    <span className="t-small block text-secondary">{l.detail}</span>
                  </span>
                  <Icon name="chevron-forward" className="text-muted" />
                </span>
              </a>
            ))}
          </div>
        </Reveal>
        <Reveal index={2}>
          <Card>
            <p className="t-body-strong">Tout effacer</p>
            <p className="t-small mt-1 text-secondary">Compte → « Supprimer mon compte » : tout ce que le serveur garde est effacé, pour toutes les apps, tout de suite.</p>
            <Button className="mt-3" variant="secondary" to="/compte">
              Aller au compte
            </Button>
          </Card>
        </Reveal>
        <a href="/confidentialite" className="t-small px-1 text-accent underline">
          Ce que MyLife garde, et pourquoi (confidentialité)
        </a>
      </div>
    </Screen>
  );
}

const KINDS = [
  { value: 'bug', label: 'Un problème' },
  { value: 'idee', label: 'Une idée' },
  { value: 'question', label: 'Une question' },
  { value: 'donnees', label: 'Mes données (RGPD)' },
] as const;

/** « Un problème, une idée ? » : un message à l'équipe (non chiffré, et c'est dit). */
export function SupportCard() {
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const s = currentSession();
    if (!s) return;
    setBusy(true);
    try {
      await webPlatform.api.call('/api/support', { action: 'send', kind, message: message.trim(), app: 'home' }, s.token);
      setMessage('');
      toast({ message: 'Message envoyé : merci !', tone: 'gold' });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <p className="t-body-strong">Un problème, une idée ?</p>
      <div className="mt-3 flex flex-col gap-2">
        <SelectField label="C’est…" value={kind} onChange={setKind} options={KINDS} />
        <TextField label="Ton message" value={message} onChange={setMessage} placeholder="Raconte-nous" />
        <Button variant="secondary" icon="chat" disabled={busy || message.trim().length < 3} onClick={() => void send()}>
          {busy ? 'Envoi…' : 'Envoyer'}
        </Button>
        <p className="t-caption text-muted">Ce message n’est pas chiffré : l’équipe MyLife pourra le lire. N’y mets pas de données sensibles. Effacé une fois traité (90 jours au plus).</p>
      </div>
    </Card>
  );
}
