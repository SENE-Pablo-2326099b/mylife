import { describe, expect, it } from 'vitest';
import { buildCrewScore, parseCrewScore, rankCrew, sameCrewScore } from '../packages/lumen/src/crew';
import { addWeeks, computeCharacter, levelFor, mergeStats, monthWeeks, recap, recapWeekFor, timeline, wrappedFor, yearWeeks, parseStats, sameStats, titleFor, trimWeeks, weekStart, XP, xpForLevel, type AppStats } from '../packages/lumen/src/character';

const stats = (weeks: AppStats['weeks'], goal?: number): AppStats => ({ v: 1, at: 1, weeks, ...(goal ? { goal } : {}) });
// Jeudi 22 octobre 2026 : semaine du lundi 19.
const TODAY = '2026-10-22';
const W = '2026-10-19';
const prev = (n: number) => addWeeks(W, -n);

describe('semaines et niveaux', () => {
  it('le lundi de la semaine, y compris le dimanche et en changeant d’année', () => {
    expect(weekStart('2026-10-22')).toBe('2026-10-19');
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
  });
  it('courbe : 100 × (niveau − 1)^1,5, niveaux croissants', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(5)).toBe(800);
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(800)).toMatchObject({ level: 5, levelXp: 800 });
    expect(levelFor(450).progress).toBeGreaterThan(0);
    expect(levelFor(450).progress).toBeLessThan(1);
  });
  it('titres par paliers', () => {
    expect(titleFor(1)).toBe('Novice');
    expect(titleFor(9)).toBe('Apprenti');
    expect(titleFor(10)).toBe('Aventurier');
    expect(titleFor(75)).toBe('Légende');
  });
});

describe('personnage', () => {
  it('aucune app : personnage vide, niveau 1, aucune quête', () => {
    const c = computeCharacter({}, TODAY);
    expect(c).toMatchObject({ empty: true, level: 1, title: 'Novice', xp: 0, streak: 0, quests: [] });
    expect(c.stats.find((s) => s.id === 'culture')?.locked).toBe(true);
  });

  it('Culture : déverrouillée par l’historique d’écoute ; minutes plafonnées, découvertes ; aucune quête', () => {
    const c = computeCharacter({ music: stats({ [W]: { minutes: 2000, discoveries: 3 }, [prev(1)]: { minutes: 95 } }) }, TODAY);
    const culture = c.stats.find((s) => s.id === 'culture')!;
    expect(culture.locked).toBe(false);
    expect(culture.xp).toBe(XP.listenCapMinutes / XP.listenMinutesPerXp + 3 * XP.discovery + 9);
    expect(c.quests).toEqual([]);
  });

  it('séances et records font monter la Force ; l’objectif de la quête suit le réglage de MyPerf', () => {
    const c = computeCharacter({ perf: stats({ [W]: { sessions: 4, records: 1 } }, 4) }, TODAY);
    const force = c.stats.find((s) => s.id === 'force')!;
    expect(force.xp).toBe(4 * XP.session + XP.record + XP.quest.force);
    expect(c.quests.find((q) => q.id === 'force')).toMatchObject({ title: 'Fais 4 séances', progress: 4, target: 4, done: true });
    expect(force.week).toBe(force.xp);
  });

  it('plafonds : une semaine hors norme ne fait pas tout', () => {
    const c = computeCharacter({ perf: stats({ [W]: { sessions: 20, records: 30 } }, 3) }, TODAY);
    expect(c.stats.find((s) => s.id === 'force')!.xp).toBe(XP.session * XP.sessionCap + XP.record * XP.recordCap + XP.quest.force);
  });

  it('Discipline : jours sous le budget, quête à 5 jours, cycle d’épargne tenu', () => {
    const c = computeCharacter({ finances: stats({ [W]: { under: 5, tracked: 5, saved: 1 } }) }, TODAY);
    expect(c.stats.find((s) => s.id === 'discipline')!.xp).toBe(5 * XP.underDay + XP.savedCycle + XP.quest.discipline);
    expect(c.quests.find((q) => q.id === 'discipline')?.done).toBe(true);
  });

  it('une app jamais utilisée n’a pas de quête ; la quête Social est un bonus', () => {
    const c = computeCharacter({ perf: stats({ [W]: { sessions: 1 } }), raveloc: stats({ [prev(3)]: { groups: 1, friends: 3 } }) }, TODAY);
    expect(c.quests.map((q) => q.id)).toEqual(['force', 'social', 'full']);
    expect(c.quests.find((q) => q.id === 'social')).toMatchObject({ bonus: true, done: false });
  });

  it('série : semaines réussies d’affilée ; la semaine en cours ne casse rien tant qu’elle n’est pas finie', () => {
    const perf = stats({ [prev(3)]: { sessions: 3 }, [prev(2)]: { sessions: 3 }, [prev(1)]: { sessions: 3 }, [W]: { sessions: 1 } }, 3);
    expect(computeCharacter({ perf }, TODAY).streak).toBe(3);
    perf.weeks[W] = { sessions: 3 };
    expect(computeCharacter({ perf }, TODAY).streak).toBe(4);
  });

  it('une semaine manquée remet la série à zéro, sauf si elle est déclarée de repos', () => {
    const perf = stats({ [prev(3)]: { sessions: 3 }, [prev(2)]: {}, [prev(1)]: { sessions: 3 } }, 3);
    expect(computeCharacter({ perf }, TODAY).streak).toBe(1);
    expect(computeCharacter({ perf }, TODAY, [prev(2)]).streak).toBe(2);
  });

  it('deux apps : réussir une semaine demande les deux quêtes ; une semaine bancaire trop peu suivie ne compte pas', () => {
    const perf = stats({ [prev(2)]: { sessions: 3 }, [prev(1)]: { sessions: 3 } }, 3);
    const finances = stats({ [prev(2)]: { under: 1, tracked: 7 }, [prev(1)]: { under: 1, tracked: 2 } });
    const c = computeCharacter({ perf, finances }, TODAY);
    // prev(2) : Discipline ratée (1 jour sur 7 suivis) → semaine ratée ; prev(1) : pas assez suivie → seule la Force compte.
    expect(c.history.find((h) => h.week === prev(2))?.good).toBe(false);
    expect(c.history.find((h) => h.week === prev(1))?.good).toBe(true);
    expect(c.streak).toBe(1);
  });

  it('semaine complète : bonus quand toutes les quêtes sont faites', () => {
    const c = computeCharacter({ perf: stats({ [W]: { sessions: 3 } }, 3), raveloc: stats({ [W]: { groups: 1, friends: 2 } }) }, TODAY);
    expect(c.quests.find((q) => q.id === 'full')).toMatchObject({ done: true, target: 2 });
  });

  it('un utilisateur de longue date ne démarre pas niveau 1 ; même calcul partout (déterministe)', () => {
    const weeks: AppStats['weeks'] = {};
    for (let i = 0; i < 40; i++) weeks[prev(i)] = { sessions: 4, records: i % 4 === 0 ? 1 : 0 };
    const a = computeCharacter({ perf: stats(weeks, 4) }, TODAY);
    const b = computeCharacter({ perf: stats(structuredClone(weeks), 4) }, TODAY);
    expect(a.level).toBeGreaterThan(5);
    expect(a).toEqual(b);
    expect(a.history).toHaveLength(12);
    expect(a.streak).toBe(40);
  });
});

describe('lignes de stats', () => {
  it('lecture prudente : versions, semaines et nombres invalides écartés', () => {
    expect(parseStats(null)).toBeNull();
    expect(parseStats({ v: 2, at: 1, weeks: {} })).toBeNull();
    expect(parseStats({ v: 1, at: 1, weeks: { 'pas-une-date': { sessions: 1 }, [W]: { sessions: 2, records: -1, x: 'a' } } })).toEqual({ v: 1, at: 1, weeks: { [W]: { sessions: 2 } } });
  });
  it('comparaison sans la date, et tri des semaines indifférent', () => {
    expect(sameStats(stats({ [W]: { a: 1, b: 2 }, [prev(1)]: { a: 1 } }), { ...stats({ [prev(1)]: { a: 1 }, [W]: { b: 2, a: 1 } }), at: 99 })).toBe(true);
    expect(sameStats(stats({ [W]: { a: 1 } }), stats({ [W]: { a: 2 } }))).toBe(false);
  });
  it('fusion (MyRave) : par semaine et par compteur, le plus grand ; deux appareils ne s’effacent jamais', () => {
    const a: AppStats = { v: 1, at: 5, weeks: { [prev(2)]: { groups: 1, friends: 4 }, [W]: { groups: 1 } } };
    const b: AppStats = { v: 1, at: 9, weeks: { [W]: { groups: 2, friends: 3 } } };
    expect(mergeStats(a, b)).toEqual({ v: 1, at: 9, weeks: { [prev(2)]: { groups: 1, friends: 4 }, [W]: { groups: 2, friends: 3 } } });
    expect(mergeStats(null, b)).toBe(b);
  });
  it('ne garde que deux ans de semaines non vides', () => {
    expect(Object.keys(trimWeeks({ [W]: { a: 1 }, [prev(200)]: { a: 1 }, [prev(1)]: { a: 0 } }, TODAY))).toEqual([W]);
  });
});

describe('bilans', () => {
  const perf = stats({ [prev(2)]: { sessions: 3, records: 1 }, [prev(1)]: { sessions: 4, records: 2 }, [W]: { sessions: 1 } }, 3);
  const finances = stats({ [prev(2)]: { under: 6, tracked: 7, saved: 1 }, [prev(1)]: { under: 3, tracked: 7 } });
  const raveloc = stats({ [prev(1)]: { groups: 1, friends: 4 } });

  it('semaine : compteurs, quêtes, points ; rien pour les apps sans activité', () => {
    const r = recap({ perf, finances, raveloc }, TODAY, prev(1), prev(1));
    expect(r).toMatchObject({ weeks: 1, sessions: 4, records: 2, goalWeeks: 1, under: 3, tracked: 7, saved: 0, socialWeeks: 1, friends: 4 });
    expect(r.questsTotal).toBe(3);
    expect(r.questsDone).toBe(2);
    expect(r.xp).toBe(timeline({ perf, finances, raveloc }, TODAY).find((w) => w.week === prev(1))!.total);
    expect(recap({ perf }, TODAY, prev(1), prev(1)).apps).toEqual({ perf: true, finances: false, raveloc: false, music: false });
  });

  it('période : sommes, meilleure semaine, niveaux gagnés, plus longue série', () => {
    const r = recap({ perf, finances, raveloc }, TODAY, prev(2), W);
    expect(r.sessions).toBe(8);
    expect(r.saved).toBe(1);
    expect(r.bestWeek?.week).toBeDefined();
    expect(r.levelEnd).toBeGreaterThanOrEqual(r.levelStart);
    expect(r.xp).toBe(Object.values(r.xpByStat).reduce((a, b) => a + b, 0));
    expect(r.bestStreak).toBeGreaterThanOrEqual(1);
  });

  it('semaines d’un mois et d’une année : lundis tombant dedans', () => {
    expect(monthWeeks('2026-10')).toEqual({ from: '2026-10-05', to: '2026-10-26' });
    expect(monthWeeks('2026-06')).toEqual({ from: '2026-06-01', to: '2026-06-29' });
    expect(yearWeeks('2026')).toEqual({ from: '2026-01-05', to: '2026-12-28' });
  });

  it('carte « Ta semaine » : dimanche (la semaine qui s’achève) et lundi (celle qui vient de finir)', () => {
    expect(recapWeekFor('2026-10-25')).toBe('2026-10-19');
    expect(recapWeekFor('2026-10-26')).toBe('2026-10-19');
    expect(recapWeekFor('2026-10-22')).toBeNull();
  });

  it('Wrapped mis en avant : le mois fini (1er–7), l’année (dès le 15 décembre, jusqu’au 15 janvier)', () => {
    expect(wrappedFor('2026-11-03')).toEqual({ kind: 'month', period: '2026-10' });
    expect(wrappedFor('2026-11-08')).toBeNull();
    expect(wrappedFor('2026-12-20')).toEqual({ kind: 'year', period: '2026' });
    expect(wrappedFor('2027-01-04')).toEqual({ kind: 'year', period: '2026' });
    expect(wrappedFor('2027-02-02')).toEqual({ kind: 'month', period: '2027-01' });
  });
});

describe('Crew', () => {
  const c = computeCharacter({ perf: stats({ [W]: { sessions: 4, records: 1 } }, 4), finances: stats({ [W]: { under: 5, tracked: 5 } }) }, TODAY);

  it('le score ne contient que ce qui est choisi : niveau, titre, série, XP ; stats seulement si partagées', () => {
    const base = buildCrewScore(c, '2026-10', 900, [], 1);
    expect(Object.keys(base.stats)).toEqual([]);
    expect(base).toMatchObject({ v: 1, level: c.level, title: c.title, month: '2026-10', monthXp: 900 });
    const more = buildCrewScore(c, '2026-10', 900, ['force', 'culture'], 1);
    expect(Object.keys(more.stats)).toEqual(['force']);
    expect(JSON.stringify(more)).not.toMatch(/sessions|under|tracked/);
  });

  it('lecture prudente d’un score reçu', () => {
    expect(parseCrewScore({ v: 1, level: 5, title: 'Apprenti', streak: 2, month: '2026-10', monthXp: 10, weekXp: 3, stats: { force: 4, hack: 9 }, at: 1 })).toMatchObject({ stats: { force: 4 } });
    expect(parseCrewScore({ v: 1, level: -1, title: 'x', streak: 0, month: '2026-10', monthXp: 0, weekXp: 0 })).toBeNull();
    expect(parseCrewScore({ v: 1, level: 2, title: 'x', streak: 0, month: 'octobre', monthXp: 0, weekXp: 0 })).toBeNull();
  });

  it('classement du mois : XP du mois puis niveau ; un vieux score compte pour 0 ; ex aequo', () => {
    const s = (level: number, month: string, monthXp: number) => buildCrewScore({ ...c, level }, month, monthXp, [], 1);
    const scores = new Map([
      ['a', s(10, '2026-10', 500)],
      ['b', s(20, '2026-09', 9000)],
      ['c', s(8, '2026-10', 500)],
    ]);
    const ranked = rankCrew([{ uid: 'a', pseudo: 'Ana' }, { uid: 'b', pseudo: 'Bob' }, { uid: 'c', pseudo: 'Cyd' }, { uid: 'd', pseudo: 'Dan' }], scores, 'c', '2026-10');
    expect(ranked.map((r) => [r.pseudo, r.rank, r.monthXp, r.me])).toEqual([
      ['Ana', 1, 500, false],
      ['Cyd', 2, 500, true],
      ['Bob', 3, 0, false],
      ['Dan', 4, 0, false],
    ]);
    expect(sameCrewScore(s(1, '2026-10', 1), { ...s(1, '2026-10', 1), at: 99 })).toBe(true);
  });
});
