// `npm run local` : l'app construite + l'API sur une base en mémoire (port 4320). `npm run dev` y relaie /api.
import { startLocalServer } from '../server/local';

const s = await startLocalServer({ port: Number(process.env.PORT ?? 4320) });
console.log(`myRaveLoc local : ${s.url}/raveloc/ (base en mémoire ; code d’invitation MyLife : ${s.invite})`);
