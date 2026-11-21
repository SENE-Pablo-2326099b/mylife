/**
 * Partage autour de l'import de programmes, sur le web : presse-papier, téléchargement du fichier
 * d'export, ouverture d'un fichier .json / .txt. (Téléphone : programShare.ts.)
 */
export const CAN_PICK_FILE = true;

export async function copyOrShare(text: string): Promise<'copied' | 'shared' | 'failed'> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export async function shareProgramFile(json: string, name: string): Promise<'downloaded' | 'shared' | 'failed'> {
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

/** Ouvre un fichier texte (.json, .txt, .md, .csv) choisi par l'utilisateur ; null s'il annule. */
export function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,.md,.csv,application/json,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function openUrl(url: string): void {
  window.open(url, '_blank', 'noopener');
}
