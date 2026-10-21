/**
 * Web (PWA MyLife) : pas de système de fichiers ni de feuille de partage. L'export télécharge le
 * fichier, l'import passe par le sélecteur de fichiers du navigateur. Même format que sur le téléphone :
 * une sauvegarde exportée de l'app Android se restaure ici, et inversement.
 */
import { today } from '@/domain/dates';
import { buildBackup, restoreBackup, setsCsv } from '@/db/backup';

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportJson(): Promise<void> {
  download(`myperf-${today()}.json`, JSON.stringify(buildBackup()), 'application/json');
}

export async function exportCsv(): Promise<void> {
  download(`myperf-series-${today()}.csv`, setsCsv(), 'text/csv');
}

/** Sélection d'un fichier de sauvegarde JSON puis restauration. null si annulé. */
export function importJson(): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json,text/plain';
    let settled = false;
    input.addEventListener('change', () => {
      settled = true;
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file
        .text()
        .then((text) => resolve(restoreBackup(JSON.parse(text) as unknown)))
        .catch(reject);
    });
    // Fenêtre fermée sans choix : le focus revient sans « change ».
    window.addEventListener(
      'focus',
      () =>
        setTimeout(() => {
          if (!settled) resolve(null);
        }, 1000),
      { once: true },
    );
    input.click();
  });
}
