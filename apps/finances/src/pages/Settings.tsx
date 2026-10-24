import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { computeEnvelope, totalIncome } from '../domain/defaults';
import { useSettings } from '../hooks';
import { APP_NAME } from '../lib/app';
import { formatCents } from '../ui/money';
import { useAppearanceSummary } from '../ui/appearance';
import { checkForUpdate } from '../lib/pwaUpdate';
import { useCloud } from '../sync/cloud';
import { Button, Card, Group, Icon, Reveal, Row, SectionTitle } from '../ui/index';
import { Screen } from '../ui/Screen';

export default function SettingsPage() {
  const s = useSettings();
  const cloud = useCloud();
  const counts = useLiveQuery(async () => ({ rules: await db.rules.count(), cats: await db.categories.count() }), []);
  const appearance = useAppearanceSummary();
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

      {/* Seulement des réglages. Le compte, les banques et l'assistant sont dans les Espaces MyLife (en haut à droite),
          les banques aussi dans Opérations, l'import Trade Republic dans Patrimoine. */}
      <Reveal index={1}>
        <SectionTitle>Budget</SectionTitle>
        <Group>
          <Row icon="cash" title="Revenus, charges et épargne" subtitle={`Paie le ${s.payday} · ${formatCents(totalIncome(s), { compact: true })} de revenus · enveloppe ${formatCents(computeEnvelope(s), { compact: true })}`} to="/reglages/budget" />
          <Row icon="tag" title="Catégories et objectifs" subtitle={`${counts?.cats ?? '…'} catégories`} to="/reglages/categories" />
          <Row icon="rules" title="Règles de classement" subtitle={`${counts?.rules ?? '…'} règles · commerçants, mots-clés`} to="/reglages/regles" />
          <Row icon="bell" title="Seuils d’alerte" subtitle="Livraisons, achats hors budget, objectifs" to="/reglages/alertes" />
        </Group>
      </Reveal>

      <Reveal index={2}>
        <SectionTitle>App</SectionTitle>
        <Group>
          <Row icon="palette" title="Apparence" subtitle={appearance} to="/reglages/apparence" />
          <Row icon="shield" title="Sauvegarde et données" subtitle="Export, import, points de restauration, démo" to="/reglages/donnees" />
        </Group>
        <p className="t-caption mt-3 px-1 text-muted">
          Ton compte MyLife{cloud.session ? ` (${cloud.session.login})` : ''}, les banques et l’assistant sont dans les Espaces, en haut à droite de chaque écran.
        </p>
        <p className="t-caption mt-6 text-center text-muted">
          {APP_NAME} · tes données chiffrées, à toi seul. Aucune publicité, aucun traceur.
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
