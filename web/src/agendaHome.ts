import { useEffect } from 'react';
import { localToday, writeAgenda } from './vendor/lumen';
import { loadCrews, useCrews } from './crew';
import { sortieDigests } from './sortieDigest';
import { spaceSnapshot, syncSpaceNow } from './spaceSync';

/**
 * Ce que l'accueil met dans l'agenda commun (V4, F3) : les sorties à venir ou en cours, sauf celles où tu as répondu
 * « non ». Recalculé quand les espaces changent.
 */
const fetched = new Set<string>();

export function useHomeAgenda(): void {
  const crews = useCrews();
  // Sans être passé par Sorties ou Crew, la liste des espaces n'est pas encore chargée : l'accueil la demande.
  useEffect(() => {
    if (crews.status === 'idle') void loadCrews();
  }, [crews.status]);
  useEffect(() => {
    if (crews.status !== 'ready') return;
    let alive = true;
    const publish = () => {
      const today = localToday();
      writeAgenda(
        'home',
        today,
        sortieDigests(crews.sorties, crews.uid)
          .filter((s) => s.end >= today && s.myAnswer !== 'non')
          .map((s) => ({ id: s.id, kind: 'sortie' as const, title: s.decided ? s.name : `${s.name} (à confirmer)`, date: s.start, end: s.end > s.start ? s.end : undefined, url: `/sorties/${s.id}` })),
      );
    };
    publish();
    // Une sortie jamais ouverte sur cet appareil : son contenu (nom, dates) n'est pas encore là. Une fois par session.
    const missing = crews.sorties.filter((s) => !fetched.has(s.id) && !spaceSnapshot(s.id).records.some((r) => r.tbl === 'info'));
    for (const s of missing) fetched.add(s.id);
    if (missing.length)
      void Promise.allSettled(missing.map((s) => syncSpaceNow(s))).then(() => {
        if (alive) publish();
      });
    return () => {
      alive = false;
    };
  }, [crews]);
}
