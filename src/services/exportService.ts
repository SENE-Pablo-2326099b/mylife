import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { today } from '@/domain/dates';
import { buildBackup, restoreBackup, setsCsv } from '@/db/backup';

function writeTemp(name: string, content: string): File {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file;
}

async function share(file: File, mimeType: string, UTI: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Partage indisponible sur cet appareil');
  await Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle: 'Exporter' });
}

export async function exportJson(): Promise<void> {
  const file = writeTemp(`myperf-${today()}.json`, JSON.stringify(buildBackup()));
  await share(file, 'application/json', 'public.json');
}

export async function exportCsv(): Promise<void> {
  const file = writeTemp(`myperf-series-${today()}.csv`, setsCsv());
  await share(file, 'text/csv', 'public.comma-separated-values-text');
}

/** Lets the user pick a JSON backup and restores it. Returns restored rows, or null if cancelled. */
export async function importJson(): Promise<number | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', '*/*'] });
  if (picked.canceled) return null;
  const parsed: unknown = JSON.parse(await picked.result.text());
  return restoreBackup(parsed);
}
