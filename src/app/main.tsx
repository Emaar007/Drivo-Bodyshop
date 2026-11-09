import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Self-hosted font (no external requests): Inter variable with optical sizing, one family for everything.
import '@fontsource-variable/inter/opsz.css';
import './index.css';
import App from './App';
import { DataProvider } from './store';

// Theme: dark by default (the operations console); "Paper" when the viewer picked light.
try {
  const saved = localStorage.getItem('theme');
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DataProvider>
        <App />
      </DataProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
