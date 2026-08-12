import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useGLTF } from '@react-three/drei';
import { App } from './app/App';
import { loadBuiltinPlugins } from './plugins';
import './index.css';

// Point Draco at the decoder bundled in public/, before anything loads a model.
//
// This has to be global, not per-call. drei keeps ONE module-level DRACOLoader
// and re-points it on every useGLTF call, so any call that omits a decoder path
// silently resets it to drei's gstatic.com default — which the app's CSP
// (`connect-src 'self'`) blocks. One un-annotated drone load was enough to
// break the Draco-compressed classroom, depending purely on load order.
//
// The path is relative so it resolves against the document base: correct under
// the dev server and under file:// in a packaged build, where a leading slash
// would point at the filesystem root.
useGLTF.setDecoderPath('draco/gltf/');

// Register built-in drones/environments before the app reads the registry.
loadBuiltinPlugins();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
