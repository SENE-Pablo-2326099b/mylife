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
// Polices des identités (Circuit, Ardoise, Argile, Brut) : déclarées ici, téléchargées seulement quand le thème les affiche.
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-500.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo/latin-800.css';
import '@fontsource/archivo/latin-900.css';
import App from './App';
import { BASE_PATH } from './lib/app';
import { installErrorLog } from './lib/errorLog';
import { startServiceWorker } from './lib/pwaUpdate';
// Compte MyLife : installe le suivi des modifications avant l'ouverture de la base.
import './sync/cloud';
import { bootTheme } from './ui/themeRuntime';
import { installGlassLight } from './ui/glassLight';
import './index.css';

// Plantages gardés sur l'appareil (jamais envoyés) pour pouvoir les signaler.
installErrorLog();

// Bonnes couleurs dès la première image (thème recopié au dernier lancement).
bootTheme();

// Lumière au contact du verre (pointeur, doigt).
installGlassLight();

// Service worker : l'app fonctionne hors ligne et se met à jour automatiquement.
startServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={BASE_PATH || undefined} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
