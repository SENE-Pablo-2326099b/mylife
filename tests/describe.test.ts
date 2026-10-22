import { describe as group, expect, it } from 'vitest';
import { describe, sortFriends } from '../src/lib/describe';
import type { Member } from '../src/state/app';
import type { Fix } from '../src/domain/status';

const now = 1_800_000_000_000;
const me: Fix = { lat: 48.8566, lon: 2.3522, acc: 8, at: now - 2000 };
const base: Member = { uid: 'u_b', name: 'Bob', role: 'member', me: false, sharing: 'on', shareUntil: now + 3_600_000, seenAt: now, fix: null, unreadable: false };
const fix = (o: Partial<NonNullable<Member['fix']>> = {}) => ({ lat: 48.8575, lon: 2.3535, acc: 10, ageAtReceipt: 3000, receivedAt: now, ...o });

group('ligne d’un ami', () => {
  it('position à jour : précision et distance arrondie', () => {
    const l = describe({ ...base, fix: fix() }, me, now);
    expect(l.state).toBe('live');
    expect(l.text).toBe('Position à jour · ±\u00a010\u00a0m');
    expect(l.tone).toBe('ok');
    expect(l.distance).toMatch(/^≈ 1[34]0\u00a0m$/);
  });
  it('position ancienne : annoncée comme telle, jamais « à jour »', () => {
    const l = describe({ ...base, fix: fix({ ageAtReceipt: 90_000 }) }, me, now);
    expect(l.text).toMatch(/^Dernière position il y a 1 min/);
    expect(l.tone).toBe('warn');
    const silent = describe({ ...base, fix: fix({ ageAtReceipt: 20 * 60_000 }) }, me, now);
    expect(silent.state).toBe('silent');
    expect(silent.text).toMatch(/Plus de nouvelles depuis 20 min/);
    expect(silent.tone).toBe('danger');
  });
  it('position imprécise signalée', () => {
    const l = describe({ ...base, fix: fix({ acc: 120 }) }, me, now);
    expect(l.imprecise).toBe(true);
    expect(l.text).toContain('imprécise (±\u00a0120\u00a0m)');
  });
  it('ne partage pas / pause / en attente / illisible : pas de distance inventée', () => {
    expect(describe({ ...base, sharing: 'off' }, me, now)).toMatchObject({ state: 'not-sharing', distance: null });
    expect(describe({ ...base, sharing: 'paused', fix: fix() }, me, now).text).toMatch(/^Partage en pause · position figée/);
    expect(describe(base, me, now)).toMatchObject({ state: 'waiting', distance: null });
    expect(describe({ ...base, unreadable: true }, me, now)).toMatchObject({ tone: 'danger', distance: null });
  });
  it('ma position inconnue ou périmée : distance non calculée, raison donnée', () => {
    expect(describe({ ...base, fix: fix() }, null, now)).toMatchObject({ distance: null, noDistance: 'Ta position est inconnue' });
    expect(describe({ ...base, fix: fix() }, { ...me, at: now - 10 * 60_000 }, now).distance).toBeNull();
  });
  it('tri : localisables d’abord, puis les plus proches', () => {
    const a = { ...base, uid: 'a', name: 'Loin', fix: fix({ lat: 48.87 }) };
    const b = { ...base, uid: 'b', name: 'Près', fix: fix() };
    const c = { ...base, uid: 'c', name: 'Absent', sharing: 'off' as const };
    const sorted = sortFriends([c, a, b].map((m) => ({ m, line: describe(m, me, now) })));
    expect(sorted.map((x) => x.m.name)).toEqual(['Près', 'Loin', 'Absent']);
  });
});
