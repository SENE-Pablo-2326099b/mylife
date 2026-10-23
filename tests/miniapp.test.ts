import { describe, expect, it } from 'vitest';
import {
  MINI_TEMPLATES,
  addEntry,
  aggregate,
  cleanValues,
  decodeSpec,
  deleteMiniApp,
  emptyMiniApp,
  encodeSpec,
  extractJson,
  formatMini,
  goalProgress,
  miniAppPrompt,
  parseMiniApp,
  parseSpec,
  removeEntry,
  statValue,
  weeklySeries,
  type MiniSpec,
} from '../packages/lumen/src/miniapp';

const spec = (raw: unknown): MiniSpec => {
  const r = parseSpec(raw);
  if (!r.spec) throw new Error(r.error);
  return r.spec;
};

describe('Mes apps : la description', () => {
  it('lit une réponse d’IA (bloc de code, texte autour), complète les valeurs par défaut, retrouve un champ cité par son nom', () => {
    const text = 'Voici ton app :\n```json\n{"name":"Vélo","fields":[{"label":"Distance","type":"number","unit":"km"},{"label":"Météo","type":"choice","options":["Soleil","Pluie","Soleil"]}],"goal":{"agg":"sum","field":"Distance","per":"week","target":50},"stats":[{"agg":"sum","field":"distance","period":"month"},{"agg":"top","field":"meteo"},{"agg":"sum","field":"meteo"}],"icon":"fusée","color":"fuchsia"}\n```\nBonne route !';
    const s = spec(extractJson(text));
    expect(s.fields.map((f) => [f.id, f.type, f.unit ?? null])).toEqual([
      ['distance', 'number', 'km'],
      ['meteo', 'choice', null],
    ]);
    expect(s.fields[1]!.options).toEqual(['Soleil', 'Pluie']);
    expect(s.goal).toEqual({ agg: 'sum', field: 'distance', per: 'week', target: 50 });
    // La somme d'un choix n'a pas de sens : écartée ; libellés par défaut.
    expect(s.stats.map((x) => x.label)).toEqual(['Distance ce mois', 'Météo cette semaine']);
    expect([s.icon, s.color, s.format, s.v]).toEqual(['sparkles', 'or', 'mylife-app', 1]);
  });

  it('refuse ce qui n’a pas de sens, avec une explication', () => {
    expect(parseSpec(null).error).toMatch(/objet JSON/);
    expect(parseSpec({ name: 'X', fields: [] }).error).toMatch(/au moins un champ/);
    expect(parseSpec({ fields: [{ label: 'a', type: 'number' }] }).error).toMatch(/nom de l’app/);
    expect(parseSpec({ name: 'X', fields: [{ label: 'a', type: 'script' }] }).error).toMatch(/type inconnu/);
    expect(parseSpec({ name: 'X', fields: [{ label: 'a', type: 'choice', options: ['seul'] }] }).error).toMatch(/2 options/);
    expect(parseSpec({ name: 'X', fields: [{ label: 'a', type: 'text' }], goal: { agg: 'sum', field: 'a', target: 3 } }).error).toMatch(/somme/);
    expect(parseSpec({ format: 'autre', name: 'X', fields: [{ label: 'a', type: 'text' }] }).error).toMatch(/Format inconnu/);
    expect(() => extractJson('pas de json')).toThrow(/Aucun JSON/);
    expect(() => extractJson('{"name": ')).toThrow(/Aucun JSON|abîmé/);
  });

  it('les modèles sont valides tels quels ; la demande à l’IA contient le format et le souhait', () => {
    for (const t of MINI_TEMPLATES) expect(parseSpec(JSON.parse(JSON.stringify(t))).spec, t.name).toEqual(t);
    const p = miniAppPrompt('mes séances de piano');
    expect(p).toContain('"format": "mylife-app"');
    expect(p).toContain('mes séances de piano');
  });

  it('lien de partage : la description seule, accents compris ; un lien abîmé est expliqué', () => {
    const s = MINI_TEMPLATES[3]!;
    const code = encodeSpec(s);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSpec(code).spec).toEqual(s);
    expect(decodeSpec('%%%').error).toMatch(/abîmé/);
  });
});

describe('Mes apps : saisies et calculs', () => {
  const lecture = MINI_TEMPLATES[0]!;
  const today = '2026-10-23'; // un vendredi

  it('saisie vérifiée : obligatoire, bornes, choix, durée ; relecture tolérante', () => {
    expect(cleanValues(lecture, { livre: 'Dune' }).error).toMatch(/Pages lues/);
    expect(cleanValues(lecture, { pages: '12,5' }).values).toEqual({ pages: 12.5 });
    expect(cleanValues(lecture, { pages: -3 }).error).toMatch(/invalide/);
    const humeur = MINI_TEMPLATES[3]!;
    expect(cleanValues(humeur, { humeur: 'Génial' }).error).toMatch(/choix inconnu/);
    expect(cleanValues(MINI_TEMPLATES[2]!, { duree: 2000 }).error).toMatch(/invalide/);
    expect(cleanValues(MINI_TEMPLATES[2]!, { duree: 420, qualite: 9 }, true).values).toEqual({ duree: 420 });
  });

  it('stats, objectif de la semaine, série, graphique', () => {
    let app = emptyMiniApp('abc123', lecture, 1);
    const add = (id: string, day: string, pages: number, livre?: string) => (app = addEntry(app, { id, day, values: { pages, ...(livre ? { livre } : {}) } }, 2));
    add('a', '2026-10-05', 160, 'Dune');
    add('b', '2026-10-13', 80, 'Dune');
    add('c', '2026-10-15', 90, 'Fondation');
    add('d', '2026-10-20', 40, 'Fondation');
    add('e', '2026-10-22', 30, 'Fondation');
    expect(app.entries.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(statValue(app.entries, lecture.stats[0]!, today)).toBe(70);
    expect(statValue(app.entries, lecture.stats[1]!, today)).toBe(400);
    expect(statValue(app.entries, lecture.stats[2]!, today)).toBe('Fondation');
    // 70 / 150 cette semaine ; les deux semaines d'avant tenues (170, 160), pas celle du 28/09.
    expect(goalProgress(lecture, app.entries, today)).toEqual({ value: 70, target: 150, done: false, streak: 2 });
    expect(weeklySeries(lecture, app.entries, today, 4)).toEqual([
      { week: '2026-09-28', value: 0 },
      { week: '2026-10-05', value: 160 },
      { week: '2026-10-12', value: 170 },
      { week: '2026-10-19', value: 70 },
    ]);
    app = removeEntry(app, 'e', 3);
    expect(aggregate(app.entries, 'count')).toBe(4);
    expect(aggregate(app.entries, 'avg', 'pages')).toBe(92.5);
    expect(aggregate([], 'max', 'pages')).toBeNull();
  });

  it('objectif par jour (cochée) et série en jours', () => {
    const eau = MINI_TEMPLATES[1]!;
    let app = emptyMiniApp('eau001', eau);
    for (const [id, day, n] of [['1', '2026-10-20', 8], ['2', '2026-10-21', 9], ['3', '2026-10-22', 5], ['4', '2026-10-23', 4], ['5', '2026-10-23', 4]] as const) app = addEntry(app, { id, day, values: { verres: n } });
    // Aujourd'hui tenu (8), hier non (5) : série d'un jour.
    expect(goalProgress(eau, app.entries, '2026-10-23')).toEqual({ value: 8, target: 8, done: true, streak: 1 });
  });

  it('formats ; relecture prudente d’une app synchronisée ; suppression qui laisse une trace', () => {
    const sommeil = MINI_TEMPLATES[2]!;
    expect(formatMini(sommeil.fields[0], 425)).toBe('7 h 05');
    expect(formatMini(sommeil.fields[0], 45)).toBe('45 min');
    expect(formatMini(sommeil.fields[1], 4)).toBe('4/5');
    expect(formatMini(lecture.fields[0], 12.5)).toBe('12,5 pages');
    expect(formatMini(undefined, true)).toBe('oui');
    expect(formatMini(undefined, null)).toBe('—');
    const raw = { v: 1, id: 'abc123', at: 5, created: 1, spec: lecture, entries: [{ id: 'x', day: '2026-10-20', values: { pages: 10, intrus: 'x' } }, { id: 'y', day: 'hier', values: { pages: 1 } }, { id: 'z', day: '2026-10-21', values: { pages: 'beaucoup' } }] };
    expect(parseMiniApp(raw)?.entries).toEqual([{ id: 'x', day: '2026-10-20', values: { pages: 10 } }]);
    expect(parseMiniApp({ ...raw, id: '../x' })).toBeNull();
    const gone = deleteMiniApp(parseMiniApp(raw)!, 9);
    expect(parseMiniApp(JSON.parse(JSON.stringify(gone)))).toEqual({ v: 1, id: 'abc123', at: 9, created: 1, spec: null, entries: [] });
  });
});
