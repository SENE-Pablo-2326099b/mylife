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

startTheme();
listenForInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/v5">
      <App />
    </BrowserRouter>
  </StrictMode>,
);
