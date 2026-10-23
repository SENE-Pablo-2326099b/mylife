import { Linking, Share } from 'react-native';

/**
 * Partage autour de l'import de programmes, dans l'app Android : la feuille de partage du téléphone sert
 * à copier les instructions ou à les envoyer directement à l'app d'IA (ChatGPT, Gemini…), et à partager
 * l'export. (Web : programShare.web.ts.)
 */
export const CAN_PICK_FILE = false;

/** Copie (web) ou partage (téléphone) un texte ; renvoie ce qui s'est passé, pour le message à afficher. */
export async function copyOrShare(text: string, title: string): Promise<'copied' | 'shared' | 'failed'> {
  try {
    const r = await Share.share({ message: text, title });
    return r.action === Share.dismissedAction ? 'failed' : 'shared';
  } catch {
    return 'failed';
  }
}

export async function shareProgramFile(json: string, name: string): Promise<'downloaded' | 'shared' | 'failed'> {
  const r = await copyOrShare(json, name);
  return r === 'shared' ? 'shared' : 'failed';
}

export async function pickTextFile(): Promise<string | null> {
  return null;
}

export function openUrl(url: string): void {
  void Linking.openURL(url);
}
