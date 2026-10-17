import { Card, Field, MoneyField, NumberField, PageTitle, Toggle, inputClass } from '../../components/ui';
import { updateSettings } from '../../db/seed';
import type { AlertSettings } from '../../db/types';
import { useSettings } from '../../hooks';
import { BackLink } from './common';

export default function AlertsSettingsPage() {
  const settings = useSettings();
  const a = settings.alerts;
  const set = <K extends keyof AlertSettings>(key: K, patch: Partial<AlertSettings[K]>) =>
    void updateSettings({ alerts: { ...a, [key]: { ...a[key], ...patch } } });

  return (
    <div className="space-y-4">
      <BackLink />
      <PageTitle>Alertes d’optimisation</PageTitle>

      <Card title="Livraisons">
        <Toggle label="Trop de livraisons dans le cycle" hint="Catégorie Livraison (Deliveroo, Uber Eats…)" checked={a.deliveries.enabled} onChange={(enabled) => set('deliveries', { enabled })} />
        {a.deliveries.enabled && <NumberField label="Nombre maximum par cycle" min={0} max={100} value={a.deliveries.maxCount} onCommit={(maxCount) => set('deliveries', { maxCount })} />}
      </Card>

      <Card title="Amazon">
        <Toggle
          label="Achat Amazon hors budget"
          hint="Achat Amazon alors que l’objectif Shopping est déjà dépassé (ou qu’aucun objectif n’est défini)."
          checked={a.amazon.enabled}
          onChange={(enabled) => set('amazon', { enabled })}
        />
        {a.amazon.enabled && <MoneyField label="Ignorer les achats inférieurs à" value={a.amazon.minAmount} onCommit={(v) => set('amazon', { minAmount: Math.abs(v ?? 0) })} />}
      </Card>

      <Card title="Budget du jour">
        <Toggle label="Dépassements consécutifs" checked={a.dailyOverrun.enabled} onChange={(enabled) => set('dailyOverrun', { enabled })} />
        {a.dailyOverrun.enabled && <NumberField label="Nombre de jours de suite" min={1} max={30} value={a.dailyOverrun.days} onCommit={(days) => set('dailyOverrun', { days })} />}
      </Card>

      <Card title="Transport">
        <Toggle label="Tickets de bus vs pass annuel" hint="Cumul sur 12 mois glissants." checked={a.transportPass.enabled} onChange={(enabled) => set('transportPass', { enabled })} />
        {a.transportPass.enabled && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <MoneyField label="Prix du pass annuel" value={a.transportPass.passPrice} onCommit={(v) => set('transportPass', { passPrice: Math.abs(v ?? 0) })} />
            <Field label="Mot-clé des tickets">
              {(id) => <input id={id} className={inputClass} defaultValue={a.transportPass.keyword} onBlur={(e) => set('transportPass', { keyword: e.target.value })} />}
            </Field>
          </div>
        )}
      </Card>

      <Card title="Objectifs par catégorie">
        <Toggle label="Catégorie au-dessus de son objectif" hint="Les objectifs se règlent dans Catégories." checked={a.categoryTarget.enabled} onChange={(enabled) => set('categoryTarget', { enabled })} />
        {a.categoryTarget.enabled && (
          <NumberField label="Prévenir à partir de (% de l’objectif)" min={1} max={100} value={a.categoryTarget.warnPercent} onCommit={(warnPercent) => set('categoryTarget', { warnPercent })} />
        )}
      </Card>
    </div>
  );
}
