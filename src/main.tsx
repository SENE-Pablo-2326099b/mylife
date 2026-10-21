import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Polices embarquées (aucun appel à un service externe) : Sora pour les titres et les chiffres, Inter pour l'interface.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/sora/latin-600.css';
import '@fontsource/sora/latin-700.css';
import App from './App';
import { BASE_PATH } from './lib/app';
import { startServiceWorker } from './lib/pwaUpdate';
import { bootTheme } from './ui/themeRuntime';
import './index.css';

// Bonnes couleurs dès la première image (thème recopié au dernier lancement).
bootTheme();

// Service worker : l'app fonctionne hors ligne et se met à jour automatiquement.
startServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={BASE_PATH || undefined} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
