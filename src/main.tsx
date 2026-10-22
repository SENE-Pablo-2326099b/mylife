import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Polices et système visuel communs à toutes les apps MyLife (kit src/ui, recopié depuis MyLife).
import './ui/fonts';
import { bootMyLife } from './ui/boot';
import { App, captureInvite } from './App';
import { start } from './state/app';
import './index.css';

bootMyLife('raveloc');
captureInvite();
start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/raveloc" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
