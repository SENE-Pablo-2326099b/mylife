import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { computeEnvelope, totalIncome } from '../domain/defaults';
import { useSettings } from '../hooks';
import { APP_NAME } from '../lib/app';
import { formatCents } from '../lib/money';
import { themeInfo, isThemeId } from '../ui/themes';
import { checkForUpdate } from '../lib/pwaUpdate';
import { Button, Card, Group, Icon, Reveal, Row, SectionTitle } from '../ui/index';
import { Screen } from '../ui/Screen';

export default function SettingsPage() {
  const s = useSettings();
  const counts = useLiveQuery(async () => ({ banks: await db.connections.where('status').equals('active').count(), rules: await db.rules.count(), cats: await db.categories.count() }), []);
  const theme = themeInfo(isThemeId(s.theme) ? s.theme : 'nuit');
  const initial = (s.firstName.trim()[0] ?? '').toUpperCase();

  return (
    <Screen title="Réglages" kicker="Ton app, à ta façon" mood="settings">
      <Reveal index={0}>
        <Card to="/reglages/profil" level="raised" className="flex items-center gap-3">
          <span className="liquid flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-[20px] font-bold">{initial || <Icon name="person" size={22} />}</span>
          <span className="min-w-0 flex-1">
            <span className="t-headline block truncate">{s.firstName.trim() || 'Ton profil'}</span>
            <span className="t-small block truncate text-secondary">
              {s.holderNames.length ? `Titulaire : ${s.holderNames.join(', ')}` : 'Prénom, noms sur tes virements'}
            </span>
          </span>
          <Icon name="chevron-forward" size={17} className="text-muted" />
        </Card>
      </Reveal>

      <Reveal index={1}>
        <SectionTitle>Budget</SectionTitle>
        <Group>
          <Row icon="cash" title="Revenus, charges et épargne" subtitle={`Paie le ${s.payday} · ${formatCents(totalIncome(s), { compact: true })} de revenus · enveloppe ${formatCents(computeEnvelope(s), { compact: true })}`} to="/reglages/budget" />
          <Row icon="tag" title="Catégories et objectifs" subtitle={`${counts?.cats ?? '…'} catégories`} to="/reglages/categories" />
          <Row icon="rules" title="Règles de classement" subtitle={`${counts?.rules ?? '…'} règles · commerçants, mots-clés`} to="/reglages/regles" />
          <Row icon="bell" title="Alertes" subtitle="Seuils et règles d’alerte" to="/reglages/alertes" />
        </Group>
      </Reveal>

      <Reveal index={2}>
        <SectionTitle>Comptes</SectionTitle>
        <Group>
          <Row icon="bank" title="Banques" subtitle={counts?.banks ? `${counts.banks} connexion${counts.banks > 1 ? 's' : ''} active${counts.banks > 1 ? 's' : ''}` : 'Connecter via Enable Banking'} to="/synchro" />
          <Row icon="diamond" title="Patrimoine et placements" subtitle="Portefeuilles, objectifs, autres actifs" to="/patrimoine" />
          <Row icon="upload" title="Importer un relevé Trade Republic" subtitle="PDF : achats, plans d’épargne, dividendes" to="/patrimoine/import" />
        </Group>
      </Reveal>

      <Reveal index={3}>
        <SectionTitle>App</SectionTitle>
        <Group>
          <Row icon="palette" title="Apparence" subtitle={`${theme.name}${s.followSystem ? ' · suit le téléphone' : ''}`} to="/reglages/apparence" />
          <Row icon="shield" title="Sauvegarde et données" subtitle="Export, import, démo, effacement" to="/reglages/donnees" />
        </Group>
        <p className="t-caption mt-6 text-center text-muted">
          {APP_NAME} · tes données restent sur cet appareil. Aucune publicité, aucun traceur.
        </p>
        <p className="t-caption mt-1 text-center text-muted">Version du {__APP_BUILD__} UTC</p>
        <div className="mt-2 flex justify-center">
          <Button variant="ghost" size="sm" icon="sync" onClick={() => void checkForUpdate()}>
            Rechercher une mise à jour
          </Button>
        </div>
      </Reveal>
    </Screen>
  );
}
