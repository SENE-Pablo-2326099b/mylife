import { balances, decide, parseAnswer, parseExpense, parseGoing, parseInfo, parseItem, parseSet, sortSets } from './vendor/lumen';
import type { Space } from './vendor/mylife-sync';
import type { SortieDigest } from './copilot';
import { spaceSnapshot } from './spaceSync';

/** Les sorties connues sur l'appareil (déjà déchiffrées), résumées pour Copilot. */
export function sortieDigests(sorties: readonly Space[], uid: string | null): SortieDigest[] {
  const out: SortieDigest[] = [];
  for (const space of sorties) {
    const data = spaceSnapshot(space.id);
    const pseudo = new Map(data.members.map((m) => [m.uid, m.pseudo]));
    const members = data.members.map((m) => m.uid);
    const infoRec = data.records.find((r) => r.tbl === 'info' && r.rid === 'main');
    const info = infoRec ? parseInfo(infoRec.row) : null;
    if (!info) continue;
    const answers = new Map(data.records.filter((r) => r.tbl === 'rsvp' && r.rid === r.author).flatMap((r) => {
      const a = parseAnswer(r.row);
      return a ? [[r.author, a] as const] : [];
    }));
    const going = new Map(data.records.filter((r) => r.tbl === 'going' && r.rid === r.author).map((r) => [r.author, parseGoing(r.row)] as const));
    const sets = sortSets(data.records.filter((r) => r.tbl === 'set').flatMap((r) => (parseSet(r.rid, r.row) ? [parseSet(r.rid, r.row)!] : [])));
    const expenses = data.records.filter((r) => r.tbl === 'expense').flatMap((r) => (parseExpense(r.rid, r.row) ? [parseExpense(r.rid, r.row)!] : []));
    const d = decide(members, answers, info.threshold);
    out.push({
      id: space.id,
      name: info.name,
      place: info.place,
      start: info.start,
      end: info.end,
      decided: d.on,
      chaud: d.chaud.length,
      myAnswer: uid ? (answers.get(uid) ?? null) : null,
      sets: sets.map((s) => ({ day: s.day, start: s.start, end: s.end, stage: s.stage, artist: s.artist, goers: [...going].filter(([, l]) => l.includes(s.id)).map(([u]) => pseudo.get(u) ?? 'Membre') })),
      myBalance: uid ? Math.round(balances(expenses, members).get(uid) ?? 0) / 100 : 0,
      totalSpent: Math.round(expenses.reduce((n, e) => n + e.cents, 0)) / 100,
      itemsLeft: data.records.filter((r) => r.tbl === 'item').flatMap((r) => {
        const i = parseItem(r.rid, r.row);
        return i && !i.done ? [i.text] : [];
      }),
    });
  }
  return out;
}
