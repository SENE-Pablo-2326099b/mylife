import { useEffect, useMemo, useState } from 'react';
import { AGENDA_EVENT, addDaysIso, enqueueAction, findConflicts, localToday, mergeAgenda, parseIcs, readAgenda, type AgendaItem, type CalendarSource } from '../vendor/lumen';
import { currentSession, webPlatform } from '../vendor/mylife-sync/web';
import { calendarEvents, calendarSources } from '../myAgendaData';
import { Icon, type IconName } from '../ui/icons';
import { Badge, Button, Card, EmptyState, Group, IconButton, Reveal, Row, SectionTitle, Sheet, TextField, toast } from '../ui/index';
import { openMyLifeApp } from '../ui/app';
import { relativeTime } from '../ui/relative';
import { Screen } from '../ui/Screen';

/**
 * MyAgenda (V4, 3.2) : l'agenda commun des apps (séances, paie, prélèvements, sorties, repas) et tes agendas importés
 * (lien ICS ou fichier), au même endroit, avec les conflits. Moteur : packages/lumen/src/calendrier.ts.
 */
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const ICON: Record<AgendaItem['kind'], IconName> = { session: 'barbell', income: 'cash', charge: 'card', savings: 'diamond', sortie: 'flag-fill', meal: 'leaf', other: 'calendar', imported: 'calendar' };
const FROM: Record<string, string> = { finances: 'MyFinances', perf: 'MyPerf', home: 'Sorties', chef: 'MyChef' };
const dayName = (iso: string, today: string) => (iso === today ? 'Aujourd’hui' : iso === addDaysIso(today, 1) ? 'Demain' : new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));

/** Lit un agenda (lien ICS par le relais, ou contenu d'un fichier) et remplace ses événements. */
async function importCalendar(sourceId: string, source: CalendarSource, content?: string): Promise<number> {
  const today = localToday();
  let ics = content;
  if (!ics) {
    const session = currentSession();
    if (!session || !source.url) throw new Error('Rien à lire.');
    ics = (await webPlatform.api.call<{ ics: string }>('/api/calendar', { action: 'fetch', url: source.url }, session.token)).ics;
  }
  const events = parseIcs(ics, sourceId, addDaysIso(today, -7), addDaysIso(today, 120));
  for (const e of calendarEvents.list()) if (e.value.source === sourceId) calendarEvents.remove(e.id);
  events.forEach((e, i) => calendarEvents.put(`${sourceId}-${i}`, e));
  calendarSources.put(sourceId, { ...source, syncedAt: Date.now() });
  return events.length;
}

function AddCalendar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (content?: string, fileName?: string) => {
    setBusy(true);
    try {
      const id = newId();
      const source: CalendarSource = { v: 1, name: (name.trim() || fileName?.replace(/\.ics$/i, '') || 'Mon agenda').slice(0, 60), ...(content ? {} : { url: url.trim() }) };
      const n = await importCalendar(id, source, content);
      toast({ message: `${source.name} : ${n} événement${n > 1 ? 's' : ''} importé${n > 1 ? 's' : ''}`, tone: 'gold' });
      setName('');
      setUrl('');
      onClose();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Ajouter un agenda">
      <div className="flex flex-col gap-3">
        <TextField label="Nom" value={name} onChange={setName} placeholder="Perso, Travail…" />
        <TextField label="Lien ICS (adresse secrète)" type="url" value={url} onChange={setUrl} placeholder="https://… ou webcal://…" plain hint="Google Agenda : Paramètres de l’agenda → « Adresse secrète au format iCal ». Apple : Partager l’agenda → Agenda public. Outlook : Calendrier → Publier. Mis à jour tout seul." />
        <Button disabled={busy || !/^(https|webcal):\/\//i.test(url.trim())} onClick={() => void save()}>
          {busy ? 'Lecture…' : 'Ajouter par lien'}
        </Button>
        <label className="flex flex-col gap-1.5">
          <span className="t-label text-muted">Ou un fichier .ics (importé une fois)</span>
          <input type="file" accept=".ics,text/calendar" className="t-small" disabled={busy} onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then((t) => save(t, f.name));
          }} />
        </label>
        <p className="t-caption text-muted">Le lien est lu par le serveur de MyLife (les navigateurs ne peuvent pas le lire directement), qui ne garde rien. Les événements sont chiffrés dans ton compte.</p>
      </div>
    </Sheet>
  );
}

export function MyAgendaPage() {
  const today = localToday();
  const sources = calendarSources.useList();
  const imported = calendarEvents.useList();
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(AGENDA_EVENT, bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener(AGENDA_EVENT, bump);
      window.removeEventListener('storage', bump);
    };
  }, []);
  // Les agendas par lien se remettent à jour tout seuls (toutes les 6 heures au plus).
  useEffect(() => {
    for (const s of sources) if (s.value.url && Date.now() - (s.value.syncedAt ?? 0) > 6 * 3_600_000) void importCalendar(s.id, s.value).catch(() => undefined);
  }, [sources]);
  const until = addDaysIso(today, 13);
  const items = useMemo(() => {
    const apps = readAgenda(today, until, today).events;
    return mergeAgenda(apps, imported.filter((i) => (i.value.endDate ?? i.value.date) >= today && i.value.date <= until), new Map(sources.map((s) => [s.id, s.value.name])));
  }, [today, until, imported, sources, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflicts = useMemo(() => findConflicts(items), [items]);
  const days = Array.from({ length: 14 }, (_, i) => addDaysIso(today, i));
  const stale = readAgenda(today, until, today).stale;

  const moveSession = (key: string, date: string) => {
    const id = key.slice('perf:'.length);
    enqueueAction({ kind: 'perf.movePlanned', params: { plannedId: id, date: addDaysIso(date, -1) }, summary: 'Avancer la séance d’un jour (MyAgenda)' }, `agenda-${id}-${Date.now()}`);
    toast({ message: 'Validé : MyPerf avance la séance dès son ouverture', tone: 'gold' });
  };

  return (
    <Screen stack title="MyAgenda" kicker="Rempli par tes apps" mood="today" back="/">
      <div className="flex flex-col gap-3">
        {conflicts.length > 0 && (
          <Reveal index={0}>
            <Card tone="warning">
              <p className="t-body-strong flex items-center gap-2">
                <Icon name="warning" size={18} /> {conflicts.length} conflit{conflicts.length > 1 ? 's' : ''} à regarder
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {conflicts.map((c, i) => {
                  const session = c.keys.find((k) => k.startsWith('perf:'));
                  return (
                    <div key={i}>
                      <p className="t-small">
                        <span className="text-secondary">{dayName(c.date, today)} :</span> {c.text}
                      </p>
                      {session && c.text.startsWith('Séance') && (
                        <div className="mt-1 flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => moveSession(session, c.date)}>
                            Avancer la séance d’un jour
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openMyLifeApp('/perf/')}>
                            Ouvrir MyPerf
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </Reveal>
        )}

        {days.map((d) => {
          const here = items.filter((i) => i.date <= d && (i.end ?? i.date) >= d);
          if (!here.length && d !== today) return null;
          return (
            <div key={d}>
              <SectionTitle>{dayName(d, today)}</SectionTitle>
              {here.length ? (
                <Group>
                  {here.map((i) => (
                    <Row
                      key={i.key}
                      to={i.url}
                      title={
                        <span className="flex items-center gap-2">
                          <Icon name={ICON[i.kind]} size={16} className="shrink-0 text-gold" />
                          {i.time && <span className="num text-secondary">{i.time}</span>}
                          <span className="truncate">{i.title}</span>
                        </span>
                      }
                      subtitle={[FROM[i.from] ?? i.from, i.place].filter(Boolean).join(' · ')}
                    />
                  ))}
                </Group>
              ) : (
                <p className="t-small px-1 text-muted">Rien de prévu.</p>
              )}
            </div>
          );
        })}
        {stale.length > 0 && <p className="t-caption px-1 text-muted">À rafraîchir : ouvre {stale.map((a) => FROM[a]).join(' et ')} (ce que tu vois date d’avant aujourd’hui).</p>}

        <SectionTitle action={<span className="t-caption text-muted">{sources.length}</span>}>Agendas importés</SectionTitle>
        {sources.length === 0 ? (
          <Card>
            <EmptyState icon="calendar" title="Ajoute ton agenda" body="Google, Apple ou Outlook, par son lien ICS ou un fichier : tes rendez-vous rejoignent tes séances, ta paie et tes sorties." />
          </Card>
        ) : (
          <Group>
            {sources.map((s) => (
              <Row
                key={s.id}
                title={s.value.name}
                subtitle={s.value.url ? `Lien · mis à jour ${relativeTime(s.value.syncedAt ?? null)}` : 'Fichier importé'}
                right={
                  <span className="flex items-center gap-1">
                    {s.value.url && (
                      <IconButton icon="sync" label={`Mettre à jour ${s.value.name}`} onClick={() => void importCalendar(s.id, s.value).then((n) => toast({ message: `${s.value.name} : ${n} événements` }), (e: unknown) => toast({ message: e instanceof Error ? e.message : String(e) }))} />
                    )}
                    <IconButton icon="trash" label={`Retirer ${s.value.name}`} onClick={() => {
                      for (const e of calendarEvents.list()) if (e.value.source === s.id) calendarEvents.remove(e.id);
                      calendarSources.remove(s.id);
                      toast({ message: `${s.value.name} retiré` });
                    }} />
                  </span>
                }
              />
            ))}
          </Group>
        )}
        <Button variant="secondary" icon="add" onClick={() => setAdding(true)}>
          Ajouter un agenda
        </Button>
        {conflicts.length === 0 && items.length > 0 && (
          <p className="t-caption px-1 text-muted">
            <Badge tone="success" icon="check">Aucun conflit</Badge> sur les deux prochaines semaines.
          </p>
        )}
      </div>
      <AddCalendar open={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}
