import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Polices et système visuel communs à toutes les apps MyLife (kit src/ui, recopié depuis MyLife).
import './ui/fonts';
import App from './App';
import { BASE_PATH } from './lib/app';
import { startServiceWorker } from './lib/pwaUpdate';
// Compte MyLife : installe le suivi des modifications avant l'ouverture de la base.
import './sync/cloud';
import { bootMyLife } from './ui/boot';
import './index.css';

// Démarrage commun des apps MyLife : journal d'erreurs local, bonnes couleurs dès la première image,
// lumière au contact du verre, apparence synchronisée entre appareils.
bootMyLife('finances');

// Service worker : l'app fonctionne hors ligne et se met à jour automatiquement.
startServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={BASE_PATH || undefined} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
