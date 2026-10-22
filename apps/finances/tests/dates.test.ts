import { describe, expect, it } from 'vitest';
import { addDays, cycleFor, cycleLength, daysRemaining, diffDays, eachDay, previousCycle, todayISO } from '../src/lib/dates';

describe('cycleFor (paie le 26)', () => {
  it('jour de paie inclus', () => {
    expect(cycleFor('2026-10-26', 26)).toEqual({ start: '2026-10-26', end: '2026-11-25' });
  });
  it('veille de paie = fin du cycle', () => {
    expect(cycleFor('2026-10-25', 26)).toEqual({ start: '2026-09-26', end: '2026-10-25' });
  });
  it('milieu de mois', () => {
    expect(cycleFor('2026-10-17', 26)).toEqual({ start: '2026-09-26', end: '2026-10-25' });
  });
  it('février 28 jours', () => {
    const c = cycleFor('2026-02-10', 26);
    expect(c).toEqual({ start: '2026-01-26', end: '2026-02-25' });
    expect(cycleLength(c)).toBe(31);
    const c2 = cycleFor('2026-02-27', 26);
    expect(c2).toEqual({ start: '2026-02-26', end: '2026-03-25' });
    expect(cycleLength(c2)).toBe(28);
  });
  it('février bissextile', () => {
    const c = cycleFor('2028-03-01', 26);
    expect(c).toEqual({ start: '2028-02-26', end: '2028-03-25' });
    expect(cycleLength(c)).toBe(29);
  });
  it('mois de 30 jours', () => {
    const c = cycleFor('2026-05-01', 26);
    expect(c).toEqual({ start: '2026-04-26', end: '2026-05-25' });
    expect(cycleLength(c)).toBe(30);
  });
  it('mois de 31 jours', () => {
    const c = cycleFor('2026-08-01', 26);
    expect(cycleLength(c)).toBe(31);
  });
  it('changement d’année', () => {
    expect(cycleFor('2026-12-31', 26)).toEqual({ start: '2026-12-26', end: '2027-01-25' });
    expect(cycleFor('2027-01-05', 26)).toEqual({ start: '2026-12-26', end: '2027-01-25' });
    expect(cycleFor('2027-01-26', 26)).toEqual({ start: '2027-01-26', end: '2027-02-25' });
  });
});

describe('jour de paie configurable', () => {
  it('paie le 1er = mois calendaire', () => {
    expect(cycleFor('2026-02-15', 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
  it('paie le 31 : ramené au dernier jour des mois courts', () => {
    expect(cycleFor('2026-02-28', 31)).toEqual({ start: '2026-02-28', end: '2026-03-30' });
    expect(cycleFor('2026-02-27', 31)).toEqual({ start: '2026-01-31', end: '2026-02-27' });
    expect(cycleFor('2026-04-30', 31)).toEqual({ start: '2026-04-30', end: '2026-05-30' });
  });
  it('paie le 30 en février', () => {
    expect(cycleFor('2026-03-10', 30)).toEqual({ start: '2026-02-28', end: '2026-03-29' });
  });
});

describe('helpers', () => {
  it('previousCycle', () => {
    expect(previousCycle({ start: '2026-01-26', end: '2026-02-25' }, 26)).toEqual({ start: '2025-12-26', end: '2026-01-25' });
  });
  it('daysRemaining inclut aujourd’hui', () => {
    const c = cycleFor('2026-10-17', 26);
    expect(daysRemaining('2026-10-17', c)).toBe(9);
    expect(daysRemaining('2026-10-25', c)).toBe(1);
    expect(daysRemaining('2026-09-26', c)).toBe(30);
    expect(daysRemaining('2026-10-30', c)).toBe(0);
  });
  it('addDays / diffDays traversent les années', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(diffDays('2026-12-25', '2027-01-25')).toBe(31);
  });
  it('changement d’heure sans effet', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(eachDay('2026-10-24', '2026-10-27')).toHaveLength(4);
  });
  it('todayISO utilise l’heure locale', () => {
    expect(todayISO(new Date(2026, 9, 17, 23, 59))).toBe('2026-10-17');
  });
});
