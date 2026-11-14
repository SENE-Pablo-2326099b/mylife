import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import '@mylife/kit/kit.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { startTheme } from '@mylife/kit';
import { App } from './App';
import { listenForInstall } from './install';
import { startPrefsSync } from '@legacy/ui/prefsSync';
import { installErrorLog } from '@legacy/ui/errorLog';
import { followSharedAppearance } from './appearance';

startTheme();
listenForInstall();
// Plantages gardés sur l'appareil (jamais envoyés), et apparence des apps d'avant synchronisée entre appareils :
// deux morceaux de l'ancien kit encore utiles, importés tels quels jusqu'à la fin des anciennes apps.
installErrorLog();
startPrefsSync();
followSharedAppearance();
// Les trois apps se préparent en arrière-plan : elles s'ouvrent tout de suite, même hors ligne.
if ('serviceWorker' in navigator) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!connection?.saveData && !/(^|-)2g$/.test(connection?.effectiveType ?? '')) {
    const run = () => ['/finances/', '/perf/', '/raveloc/'].forEach((scope) => void navigator.serviceWorker.register(`${scope}sw.js`, { scope }).catch(() => undefined));
    setTimeout(() => ('requestIdleCallback' in window ? window.requestIdleCallback(run, { timeout: 8000 }) : run()), 3000);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
