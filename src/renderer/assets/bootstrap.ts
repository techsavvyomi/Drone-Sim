import { installProtectedModelLoader } from './protectedModels';
import { trackModelLoads } from './resourceTracker';

// Runs before anything else in the renderer. main.tsx imports it FIRST.
//
// Map components start loading their models the moment their module is
// imported (`useGLTF.preload` at the top of NewYorkEnv, ForestEnv, …). ES
// modules run in import order, so anything installed from main.tsx's own body
// would already be too late for those: in a packaged build they would fetch
// their files still encrypted, and the loading screen would never see them.
// Installing here, in a module imported before App, puts both hooks in place
// before the first model is requested.

installProtectedModelLoader();
trackModelLoads();
