import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Card, PageTitle } from '../../components/ui';
import { db } from '../../db/db';
import { backupFileName, exportBackup, importBackup, wipeAll } from '../../domain/backup';
import { clearDemo, loadDemo } from '../../domain/demo';
import { useSettings } from '../../hooks';
import { BackLink } from './common';

export default function DataPage() {
  const settings = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const counts = useLiveQuery(async () => ({
    tx: await db.transactions.count(),
    demo: await db.transactions.where('source').equals('demo').count(),
    rules: await db.rules.count(),
  }), []);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
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
      return `Sauvegarde exportée (${backup.tables.transactions.length} opérations).`;
    });

  const doImport = (file: File) =>
    run(async () => {
      const data = JSON.parse(await file.text()) as unknown;
      if (!confirm('Remplacer toutes les données de cet appareil par cette sauvegarde ?')) return 'Import annulé.';
      const res = await importBackup(data);
      return `Sauvegarde restaurée : ${res.transactions} opérations.`;
    });

  return (
    <div className="space-y-4">
      <BackLink />
      <PageTitle sub="Tout est stocké dans ce navigateur (IndexedDB), sur cet appareil uniquement.">Sauvegarde et données</PageTitle>

      {msg && (
        <p role="status" className={`rounded-xl p-3 text-sm ${msg.ok ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>
          {msg.text}
        </p>
      )}

      <Card title="Sauvegarde JSON">
        <p className="mb-3 text-sm text-muted">
          {counts?.tx ?? 0} opérations, {counts?.rules ?? 0} règles. Le fichier contient toute la base (opérations, catégories, règles, réglages), sauf le mot de passe du relais.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void doExport()} disabled={busy}>
            Exporter
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
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

      <Card title="Données de démo">
        <p className="mb-3 text-sm text-muted">Environ 6 semaines d’opérations fictives sur deux comptes de démo, pour essayer l’app tout de suite. Elles ne touchent pas tes vrais comptes.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void run(async () => `${await loadDemo(settings)} opérations de démo chargées.`)}>
            Charger des données de démo
          </Button>
          {!!counts?.demo && (
            <Button variant="ghost" disabled={busy} onClick={() => void run(async () => (await clearDemo(), 'Données de démo supprimées.'))}>
              Supprimer la démo
            </Button>
          )}
        </div>
      </Card>

      <Card title="Zone dangereuse">
        <p className="mb-3 text-sm text-muted">Efface toutes les données de cet appareil et revient aux réglages par défaut. Exporte une sauvegarde avant.</p>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (confirm('Tout effacer sur cet appareil ? Cette action est irréversible.')) void run(async () => (await wipeAll(), 'Toutes les données ont été effacées.'));
          }}
        >
          Tout effacer
        </Button>
      </Card>
    </div>
  );
}
