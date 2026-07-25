import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { loadBuiltinPlugins } from './plugins';
import './index.css';

// Register built-in drones/environments before the app reads the registry.
loadBuiltinPlugins();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
