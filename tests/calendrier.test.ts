import { describe, expect, it } from 'vitest';
import { findConflicts, mergeAgenda, parseCalendarEvent, parseCalendarSource, parseIcs } from '../packages/lumen/src/calendrier';

/** MyAgenda (V4, 3.2) : agendas importés (ICS) et agenda commun des apps. */
const ics = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`;

describe('lire un agenda ICS', () => {
  it('événements à l’heure ou sur la journée, lignes repliées, échappements, lieu', () => {
    const e = parseIcs(
      ics('BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Dîner chez Sam\\, Léa\r\nLOCATION:12 rue des\r\n  Lilas\r\nDTSTART:20261028T193000\r\nDTEND:20261028T223000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Congés\r\nDTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261105\r\nEND:VEVENT\r\n'),
      'perso',
      '2026-10-24',
      '2026-12-31',
    );
    expect(e).toEqual([
      { v: 1, source: 'perso', title: 'Dîner chez Sam, Léa', date: '2026-10-28', time: '19:30', endTime: '22:30', place: '12 rue des Lilas' },
      { v: 1, source: 'perso', title: 'Congés', date: '2026-11-02', endDate: '2026-11-04' },
    ]);
  });

  it('heure UTC (Z) convertie en heure locale', () => {
    const [e] = parseIcs(ics('BEGIN:VEVENT\r\nUID:z\r\nSUMMARY:Visio\r\nDTSTART:20261030T080000Z\r\nEND:VEVENT\r\n'), 's', '2026-10-01', '2026-12-31');
    const local = new Date(Date.UTC(2026, 9, 30, 8, 0));
    expect(e!.time).toBe(`${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`);
  });

  it('répétitions : chaque semaine certains jours, nombre de fois, date de fin, exceptions ; fenêtre respectée', () => {
    const weekly = parseIcs(ics('BEGIN:VEVENT\r\nUID:w\r\nSUMMARY:Foot\r\nDTSTART:20261026T190000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4\r\nEXDATE:20261029T190000\r\nEND:VEVENT\r\n'), 's', '2026-10-01', '2026-12-31');
    expect(weekly.map((e) => e.date)).toEqual(['2026-10-26', '2026-11-02', '2026-11-05']);
    const monthly = parseIcs(ics('BEGIN:VEVENT\r\nUID:m\r\nSUMMARY:Loyer\r\nDTSTART;VALUE=DATE:20260105\r\nRRULE:FREQ=MONTHLY;UNTIL=20261231\r\nEND:VEVENT\r\n'), 's', '2026-10-24', '2026-12-31');
    expect(monthly.map((e) => e.date)).toEqual(['2026-11-05', '2026-12-05']);
    expect(() => parseIcs('pas un agenda', 's', '2026-01-01', '2026-12-31')).toThrow(/BEGIN:VCALENDAR/);
  });
});

describe('fusion et conflits', () => {
  const imported = [
    { id: 'x', value: { v: 1 as const, source: 'perso', title: 'Cinéma', date: '2026-10-28', time: '20:00', endTime: '22:00' } },
    { id: 'y', value: { v: 1 as const, source: 'perso', title: 'Dîner famille', date: '2026-10-28', time: '21:00' } },
  ];
  const apps = [
    { id: 's1', app: 'perf' as const, kind: 'session' as const, title: 'Jambes', date: '2026-10-30' },
    { id: 'f1', app: 'home' as const, kind: 'sortie' as const, title: 'Festival', date: '2026-10-31', end: '2026-11-01' },
    { id: 'm1', app: 'chef' as const, kind: 'meal' as const, title: 'Soir : Omelette', date: '2026-10-28', time: '19:30' },
  ];
  it('un seul agenda trié, d’où vient chaque élément', () => {
    const items = mergeAgenda(apps, imported, new Map([['perso', 'Agenda Google']]));
    expect(items.map((i) => `${i.date} ${i.time ?? ''} ${i.title} (${i.from})`)).toEqual([
      '2026-10-28 19:30 Soir : Omelette (chef)',
      '2026-10-28 20:00 Cinéma (Agenda Google)',
      '2026-10-28 21:00 Dîner famille (Agenda Google)',
      '2026-10-30  Jambes (perf)',
      '2026-10-31  Festival (home)',
    ]);
  });
  it('chevauchement, jambes la veille d’une sortie, repas un soir pris', () => {
    const c = findConflicts(mergeAgenda(apps, imported, new Map()));
    expect(c.map((x) => x.text)).toEqual([
      '« Cinéma » et « Dîner famille » se chevauchent',
      'Repas prévu ce soir, mais « Cinéma » à 20:00',
      'Séance « Jambes » la veille de « Festival » : tu seras courbaturé',
    ]);
  });
  it('lecture prudente', () => {
    expect(parseCalendarSource({ v: 1, name: 'Perso', url: 'http://pas-https.test/x.ics' })).toEqual({ v: 1, name: 'Perso' });
    expect(parseCalendarSource({ v: 1, name: 'Perso', url: 'webcal://p.test/abc.ics' })?.url).toBe('webcal://p.test/abc.ics');
    expect(parseCalendarEvent({ v: 1, source: 's', title: 'x', date: 'demain' })).toBeNull();
  });
});
