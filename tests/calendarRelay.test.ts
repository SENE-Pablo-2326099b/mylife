import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import * as core from '../server/core';
import { calendarDispatch, publicHttpsUrl, type FetchText } from '../server/calendar';

/** Relais des agendas ICS (MyAgenda) : rien n'est gardé, aucune adresse interne. */
const secret = 'x'.repeat(40);
const token = core.signToken('u1', secret);
const db = async () => {
  const p = new PGlite();
  await core.ensureSchema(p as unknown as core.Db);
  return p as unknown as core.Db;
};
const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\nDTSTART:20261028T190000\r\nEND:VEVENT\r\nEND:VCALENDAR';

describe('relais ICS', () => {
  it('seulement https (webcal converti), jamais d’adresse interne', () => {
    expect(publicHttpsUrl('webcal://calendar.example.com/secret/basic.ics')?.toString()).toBe('https://calendar.example.com/secret/basic.ics');
    for (const bad of ['http://calendar.example.com/a.ics', 'https://localhost/a.ics', 'https://127.0.0.1/a.ics', 'https://192.168.1.10/a.ics', 'https://10.0.0.1/a.ics', 'https://169.254.169.254/latest', 'https://[::1]/a.ics', 'https://intranet/a.ics', 'https://user:pass@example.com/a.ics', 'pas un lien'])
      expect(publicHttpsUrl(bad), bad).toBeNull();
  });

  it('renvoie l’agenda tel quel, sans rien garder ; refuse sans session, un contenu qui n’est pas un agenda, une redirection interne', async () => {
    const d = await db();
    const seen: string[] = [];
    const ok: FetchText = async (url) => (seen.push(url), { ok: true, status: 200, url, text: ICS });
    await expect(calendarDispatch(d, { secret }, undefined, { action: 'fetch', url: 'https://calendar.example.com/a.ics' }, ok)).rejects.toMatchObject({ status: 401 });
    expect(await calendarDispatch(d, { secret }, token, { action: 'fetch', url: 'webcal://calendar.example.com/a.ics' }, ok)).toEqual({ ics: ICS });
    expect(seen).toEqual(['https://calendar.example.com/a.ics']);
    await expect(calendarDispatch(d, { secret }, token, { action: 'fetch', url: 'https://example.com/page' }, async (url) => ({ ok: true, status: 200, url, text: '<html>' }))).rejects.toMatchObject({ status: 422 });
    await expect(calendarDispatch(d, { secret }, token, { action: 'fetch', url: 'https://example.com/a.ics' }, async () => ({ ok: true, status: 200, url: 'https://127.0.0.1/a.ics', text: ICS }))).rejects.toMatchObject({ status: 400 });
    await expect(calendarDispatch(d, { secret }, token, { action: 'fetch', url: 'https://example.com/a.ics' }, async (url) => ({ ok: false, status: 404, url, text: '' }))).rejects.toMatchObject({ status: 502 });
    // Rien n'est gardé : aucune table ne contient le lien.
    const { rows } = await d.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    expect(rows.map((r) => r.table_name).filter((t) => t.includes('calendar'))).toEqual(['calendar_rate']);
  }, 30_000);

  it('30 lectures par heure et par compte', async () => {
    const d = await db();
    const ok: FetchText = async (url) => ({ ok: true, status: 200, url, text: ICS });
    for (let i = 0; i < 30; i++) await calendarDispatch(d, { secret }, token, { action: 'fetch', url: 'https://example.com/a.ics' }, ok, 1_000_000);
    await expect(calendarDispatch(d, { secret }, token, { action: 'fetch', url: 'https://example.com/a.ics' }, ok, 1_000_000)).rejects.toMatchObject({ status: 429 });
  }, 30_000);
});
