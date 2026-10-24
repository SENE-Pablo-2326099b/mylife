import { addEntry, cleanValues, removeEntry, runPendingActions, type ActionSpec, type MyLifeAction } from './vendor/lumen';
import { readMiniApps, saveMiniApp } from './ui/stats';

/** Exécuteur de l'accueil (actions validées, V4 F1) : « Mes apps ». */
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

async function execute(a: MyLifeAction): Promise<ActionSpec | null> {
  const app = readMiniApps()[String(a.params.appId)];
  if (!app?.spec) throw new Error('Cette app de « Mes apps » n’existe plus.');
  if (a.kind === 'miniapp.addEntry') {
    const r = cleanValues(app.spec, a.params.values as Record<string, unknown>);
    if (r.error) throw new Error(r.error);
    const id = newId();
    saveMiniApp(addEntry(app, { id, day: String(a.params.day), values: r.values }));
    return { kind: 'miniapp.removeEntry', params: { appId: app.id, entryId: id }, summary: `Retirer la saisie ajoutée dans « ${app.spec.name} »` };
  }
  if (a.kind === 'miniapp.removeEntry') {
    const entry = app.entries.find((e) => e.id === a.params.entryId);
    if (!entry) throw new Error('Cette saisie n’existe plus.');
    saveMiniApp(removeEntry(app, entry.id));
    return { kind: 'miniapp.addEntry', params: { appId: app.id, day: entry.day, values: entry.values }, summary: `Remettre la saisie du ${entry.day} dans « ${app.spec.name} »` };
  }
  throw new Error(`Action inconnue de l’accueil : ${a.kind}`);
}

export const runHomeActions = () => runPendingActions('home', execute);
