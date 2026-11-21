import { useEffect, useRef, useState } from 'react';
import { Button, Notice, Segmented } from '@mylife/kit';
import { applyImport, ImportError, lastImportUndo, readImport, summarize, undoImport, type ImportFile, type ImportSummary } from '../data/importBackup';
import { Form } from './controls';

/**
 * Importer un fichier de données MyFinances (celui d'« Exporter mes données », ou une sauvegarde de l'app d'avant) :
 * on choisit le fichier, on voit ce qu'il contient, on choisit d'ajouter ou de tout remplacer, et on peut annuler
 * juste après.
 */
const MODES = [
  { id: 'ajouter', label: 'Ajouter' },
  { id: 'remplacer', label: 'Tout remplacer' },
] as const;
const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : null);
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count > 1 ? many : one}`;

export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: ImportFile; summary: ImportSummary } | null>(null);
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('ajouter');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [undo, setUndo] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setMode('ajouter');
    setConfirm(false);
    setError(null);
    setDone(null);
    void lastImportUndo().then(setUndo);
  }, [open]);

  const read = async (f: File) => {
    setError(null);
    setDone(null);
    try {
      const data = readImport(await f.text());
      setFile({ name: f.name, data, summary: await summarize(data) });
    } catch (e) {
      setFile(null);
      setError(e instanceof ImportError ? e.message : 'Impossible de lire ce fichier.');
    }
  };
  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await applyImport(file.data, mode === 'remplacer');
      setDone(mode === 'remplacer' ? `Tes données sont maintenant celles du fichier (${n(file.summary.transactions, 'opération')}).` : `${n(file.summary.newTransactions, 'opération ajoutée', 'opérations ajoutées')} ; les autres étaient déjà là et ont été mises à jour.`);
      setFile(null);
      setUndo(Date.now());
    } catch (e) {
      setError(`L’import a échoué : ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <Form open={open} title="Importer des données" onClose={onClose}>
      <span className="t-small muted">Un fichier fait par « Exporter mes données », ou une sauvegarde de l’ancienne MyFinances. Il est lu sur ton appareil.</span>
      <input ref={input} type="file" accept="application/json,.json" hidden aria-label="Fichier de données" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
      <Button variant={file ? 'secondary' : 'action'} block icon="plus" onClick={() => input.current?.click()}>
        {file ? 'Choisir un autre fichier' : 'Choisir le fichier'}
      </Button>
      {error && <Notice tone="bad">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}
      {file && (
        <>
          <div className="glass list" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="t-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            {when(file.summary.exportedAt) && <span className="t-small muted">Exporté le {when(file.summary.exportedAt)}</span>}
            <span className="t-small">
              {[n(file.summary.transactions, 'opération'), n(file.summary.accounts, 'compte'), file.summary.placements ? n(file.summary.placements, 'placement') : null, file.summary.goals ? n(file.summary.goals, 'objectif') : null, file.summary.hasEngine ? 'tes réglages' : null].filter(Boolean).join(' · ')}
            </span>
            <span className="t-small muted">{file.summary.newTransactions ? `${n(file.summary.newTransactions, 'opération nouvelle', 'opérations nouvelles')} pour cet appareil.` : 'Toutes ces opérations sont déjà là.'}</span>
          </div>
          <Segmented label="Façon d’importer" value={mode} options={MODES} onChange={(v) => { setMode(v); setConfirm(false); }} />
          <span className="t-small muted">
            {mode === 'ajouter'
              ? 'Ce qui manque s’ajoute ; ce qui existe déjà (même opération) est mis à jour, jamais doublé. Rien n’est effacé. Tes réglages restent les tiens.'
              : 'Toutes tes données MyFinances deviennent celles du fichier, réglages compris, sur tous tes appareils. Ton accès bancaire sur cet appareil est gardé.'}
          </span>
          {mode === 'remplacer' && confirm ? (
            <Button variant="danger" block disabled={busy} onClick={() => void run()}>
              Oui, tout remplacer
            </Button>
          ) : (
            <Button variant="action" block disabled={busy} onClick={() => (mode === 'remplacer' ? setConfirm(true) : void run())}>
              {busy ? 'Import…' : mode === 'remplacer' ? 'Tout remplacer par ce fichier' : `Ajouter ${n(file.summary.newTransactions, 'opération')}`}
            </Button>
          )}
        </>
      )}
      {undo && !file && (
        <Button
          variant="quiet"
          block
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await undoImport();
            setBusy(false);
            setUndo(null);
            setDone('Import annulé : tes données sont revenues comme avant.');
          }}
        >
          Annuler le dernier import
        </Button>
      )}
    </Form>
  );
}
