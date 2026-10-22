import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Polices et système visuel communs à toutes les apps MyLife (kit src/ui, recopié depuis packages/ui).
import './ui/fonts';
import { bootMyLife } from './ui/boot';
import { listenForInstall } from './install';
import { App } from './App';
import './index.css';

bootMyLife('home');
// L'invitation à installer arrive tôt : on la garde pour le bouton « Installer ».
listenForInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
