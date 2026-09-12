import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/shell/App';
import './ui/shell/base.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Planar: the #root element is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
