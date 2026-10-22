/**
 * Les apps de MyLife prêtes avant qu'on les ouvre : une fois l'accueil affiché et au repos, on installe
 * le service worker de chaque app (le même que l'app installerait elle-même), qui met toute l'app en
 * cache. Ouvrir MyFinances, MyPerf ou myRaveLoc est alors immédiat, même hors ligne. Rien n'est fait en
 * mode « économie de données » ni sur une connexion très lente.
 */
const APPS = ['/finances/', '/perf/', '/raveloc/'];

export function warmUpApps(): void {
  if (!('serviceWorker' in navigator)) return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return;
  const run = () => APPS.forEach((scope) => void navigator.serviceWorker.register(`${scope}sw.js`, { scope }).catch(() => undefined));
  // Après l'affichage de l'accueil, aux moments creux : jamais en concurrence avec ce qu'on regarde.
  setTimeout(() => ('requestIdleCallback' in window ? window.requestIdleCallback(run, { timeout: 8000 }) : run()), 3000);
}
