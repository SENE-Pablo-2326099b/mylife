import { updateSettings } from '../../db/seed';
import type { AlertSettings } from '../../db/types';
import { useSettings } from '../../hooks';
import { Card, MoneyField, Reveal, SectionTitle, StepperRow, TextField, ToggleRow } from '../../ui/index';
import { Screen } from '../../ui/Screen';

export default function AlertsSettingsPage() {
  const settings = useSettings();
  const a = settings.alerts;
  const set = <K extends keyof AlertSettings>(key: K, patch: Partial<AlertSettings[K]>) => void updateSettings({ alerts: { ...a, [key]: { ...a[key], ...patch } } });

  return (
    <Screen stack title="Alertes" kicker="Ce qui mérite ton attention" mood="settings" back="/reglages">
      <Reveal index={0}>
        <SectionTitle className="!mt-0">Budget du jour</SectionTitle>
        <Card className="space-y-2">
          <ToggleRow label="Dépassements consécutifs" checked={a.dailyOverrun.enabled} onChange={(enabled) => set('dailyOverrun', { enabled })} />
          {a.dailyOverrun.enabled && <StepperRow label="Jours de suite" value={a.dailyOverrun.days} min={1} max={30} onChange={(days) => set('dailyOverrun', { days })} />}
        </Card>
      </Reveal>
      <Reveal index={1}>
        <SectionTitle>Objectifs par catégorie</SectionTitle>
        <Card className="space-y-2">
          <ToggleRow label="Catégorie au-dessus de son objectif" hint="Les objectifs se règlent dans Catégories." checked={a.categoryTarget.enabled} onChange={(enabled) => set('categoryTarget', { enabled })} />
          {a.categoryTarget.enabled && <StepperRow label="Prévenir à partir de" value={a.categoryTarget.warnPercent} min={10} max={100} step={5} onChange={(warnPercent) => set('categoryTarget', { warnPercent })} format={(v) => `${v} %`} />}
        </Card>
      </Reveal>
      <Reveal index={2}>
        <SectionTitle>Livraisons</SectionTitle>
        <Card className="space-y-2">
          <ToggleRow label="Trop de livraisons dans le cycle" hint="Catégorie Livraison (Deliveroo, Uber Eats…)" checked={a.deliveries.enabled} onChange={(enabled) => set('deliveries', { enabled })} />
          {a.deliveries.enabled && <StepperRow label="Maximum par cycle" value={a.deliveries.maxCount} min={0} max={100} onChange={(maxCount) => set('deliveries', { maxCount })} />}
        </Card>
      </Reveal>
      <Reveal index={3}>
        <SectionTitle>Amazon</SectionTitle>
        <Card className="space-y-2">
          <ToggleRow label="Achat Amazon hors budget" hint="Achat Amazon alors que l’objectif Shopping est déjà dépassé (ou qu’aucun objectif n’est défini)." checked={a.amazon.enabled} onChange={(enabled) => set('amazon', { enabled })} />
          {a.amazon.enabled && <MoneyField label="Ignorer les achats inférieurs à" value={a.amazon.minAmount} onCommit={(v) => set('amazon', { minAmount: Math.abs(v ?? 0) })} />}
        </Card>
      </Reveal>
      <Reveal index={4}>
        <SectionTitle>Transports en commun</SectionTitle>
        <Card className="space-y-3">
          <ToggleRow label="Tickets vs abonnement annuel" hint="Prévient quand tes tickets sur 12 mois approchent le prix d’un abonnement." checked={a.transportPass.enabled} onChange={(enabled) => set('transportPass', { enabled })} />
          {a.transportPass.enabled && (
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <MoneyField label="Prix de l’abonnement annuel" value={a.transportPass.passPrice} onCommit={(v) => set('transportPass', { passPrice: Math.abs(v ?? 0) })} />
              <TextField label="Mot-clé des tickets" value={a.transportPass.keyword} onCommit={(keyword) => set('transportPass', { keyword })} placeholder="ex. ratp, tcl, metropole" />
            </div>
          )}
        </Card>
      </Reveal>
    </Screen>
  );
}
