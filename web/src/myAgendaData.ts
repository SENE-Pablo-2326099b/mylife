import { parseCalendarEvent, parseCalendarSource } from './vendor/lumen';
import { defineCollection } from './ui/collectionSync';

/**
 * Données de MyAgenda, chiffrées et synchronisées (app de synchro `calendrier`) : tes agendas importés (nom, lien ICS)
 * et leurs événements (répétitions dépliées sur quelques mois). L'agenda commun des apps, lui, reste sur l'appareil.
 */
export const calendarSources = defineCollection({ app: 'calendrier', name: 'sources', parse: parseCalendarSource, max: 20 });
export const calendarEvents = defineCollection({ app: 'calendrier', name: 'events', parse: parseCalendarEvent, max: 4000 });
