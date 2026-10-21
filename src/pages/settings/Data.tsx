import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { getSettings, updateSettings } from '../../db/seed';
import { backupFileName, exportBackup, importBackup, wipeAll } from '../../domain/backup';
import { clearDemo, loadDemo } from '../../domain/demo';
import { useCloud } from '../../sync/cloud';
import { Button, Card, Reveal, SectionTitle, toast } from '../../ui/index';
import { Screen } from '../../ui/Screen';

export default function DataPage() {
  const cloud = useCloud();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const counts = useLiveQuery(
    async () => ({
      tx: await db.transactions.count(),
      demo: await db.transactions.where('source').equals('demo').count(),
      rules: await db.rules.count(),
      portfolios: await db.portfolios.count(),
    }),
    [],
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  /** Remplacement annulable : la base actuelle est gardée en mémoire le temps du toast. */
  const replaceWithUndo = async (message: string, change: () => Promise<unknown>) => {
    const before = await exportBackup();
    // La sauvegarde n'emporte jamais le mot de passe du relais : on le garde à part pour l'annulation.
    const password = (await getSettings()).bridgePassword;
    await change();
    toast({
      message,
      actionLabel: 'Annuler',
      onAction: () =>
        void importBackup(before)
          .then(() => updateSettings({ bridgePassword: password }))
          .then(() => toast({ message: 'Données restaurées' })),
    });
  };

  const doExport = () =>
    run(async () => {
      const backup = await exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ message: `Sauvegarde exportée (${backup.tables.transactions.length} opérations)` });
    });

  const doImport = (file: File) =>
    run(async () => {
      const data = JSON.parse(await file.text()) as unknown;
      await replaceWithUndo('Sauvegarde restaurée', () => importBackup(data));
    });

  return (
    <Screen stack title="Sauvegarde et données" kicker="Stockées dans ce navigateur uniquement" mood="settings" back="/reglages">
      <Reveal index={0}>
        <Card>
          <p className="t-headline">Sauvegarde JSON</p>
          <p className="t-small mt-1 text-secondary">
            {counts?.tx ?? 0} opérations, {counts?.rules ?? 0} règles, {counts?.portfolios ?? 0} portefeuilles. Le fichier contient toute la base (opérations, patrimoine, catégories, règles, réglages), sauf le mot de passe du relais.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button icon="download" onClick={() => void doExport()} disabled={busy}>
              Exporter
            </Button>
            <Button variant="secondary" icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>
              Importer…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = '';
              }}
            />
          </div>
        </Card>
      </Reveal>

      <Reveal index={1}>
        <SectionTitle>Démo</SectionTitle>
        <Card>
          <p className="t-small text-secondary">Six mois d’une vie fictive : deux banques, un portefeuille d’ETF, du bitcoin en programmé, des objectifs. Pour tout essayer sans connecter de banque.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy || cloud.joined} onClick={() => void run(async () => toast({ message: `${await loadDemo()} opérations de démo chargées`, tone: 'gold' }))}>
              Charger la démo
            </Button>
            {!!counts?.demo && (
              <Button variant="secondary" disabled={busy} onClick={() => void run(() => replaceWithUndo('Démo supprimée', clearDemo))}>
                Supprimer la démo
              </Button>
            )}
          </div>
          {cloud.joined && <p className="t-caption mt-2 text-muted">Indisponible tant que cet appareil est synchronisé avec ton compte : la démo irait dans tes vraies données.</p>}
        </Card>
      </Reveal>

      <Reveal index={2}>
        <SectionTitle>Tout effacer</SectionTitle>
        <Card tone="danger">
          <p className="t-small text-secondary">
            Efface toutes les données de cet appareil{cloud.joined ? ' et de ton compte MyLife (donc de tous tes appareils synchronisés)' : ''} et revient aux réglages de départ. Tu as quelques secondes pour annuler ; exporte une sauvegarde avant si tu veux la garder.
          </p>
          <Button variant="danger" icon="trash" className="mt-3" disabled={busy} onClick={() => void run(() => replaceWithUndo('Toutes les données ont été effacées', wipeAll))}>
            Tout effacer
          </Button>
        </Card>
      </Reveal>
    </Screen>
  );
}
