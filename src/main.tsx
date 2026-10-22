import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/sora/latin-700.css';
import '@fontsource/sora/latin-800.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, captureInvite, ErrorBoundary } from './App';
import { initNav } from './state/nav';
import { start } from './state/app';
import { applyTheme } from './ui/theme';

applyTheme();
// Thème changé dans une autre app MyLife (même adresse) pendant que celle-ci est ouverte.
window.addEventListener('storage', (e) => e.key === 'mylife:appearance' && applyTheme());
captureInvite();
initNav();
start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
