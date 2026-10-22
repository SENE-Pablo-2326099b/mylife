import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Polices et système visuel communs à toutes les apps MyLife (kit src/ui, recopié depuis MyLife).
import './ui/fonts';
import App from './App';
import { BASE_PATH } from './lib/app';
import { installErrorLog } from './ui/errorLog';
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
