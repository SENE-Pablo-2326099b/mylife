// `npm run local` : MyLife complet en local (accueil, apps construites, API) sur une base en mémoire.
import { startLocalServer } from '../server/local';

const s = await startLocalServer({ port: Number(process.env.PORT ?? 4300) });
console.log(`MyLife local : ${s.url}/ (base en mémoire, inscription ouverte)`);
