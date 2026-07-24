import { loadMarketingPagesModule } from './lib/marketingModuleLoader.js';
import { initializeRealUserPerformance } from './features/performance/realUserPerformance.js';

let appLoading = false;

initializeRealUserPerformance();

const loadMainModule = () => import('./main.jsx');
const isHomeRoute = () => window.location.pathname === '/' || window.location.pathname === '';
const revealStaticHome = () => window.__minimalistRevealStaticHome?.();

const loadApp = async () => {
  if (appLoading) return;
  appLoading = true;

  const mainModulePromise = loadMainModule();

  if (isHomeRoute()) {
    // Fetch the app runtime and the real Home surface together. The static
    // document stays visible until React commits and remains the failure fallback.
    const marketingModulePromise = loadMarketingPagesModule();
    const iconStylesPromise = mainModulePromise
      .then((module) => module.loadIconStyles())
      .catch(() => undefined);
    const criticalStylesPromise = window.__minimalistCssReady || Promise.resolve();

    const [mainModule] = await Promise.all([
      mainModulePromise,
      marketingModulePromise,
      iconStylesPromise,
      criticalStylesPromise,
    ]);
    mainModule.mountApp();
    return;
  }

  const mainModule = await mainModulePromise;
  mainModule.mountApp();
};

loadApp().catch((error) => {
  revealStaticHome();
  window.__minimalistReportBootFailure?.(error);
  console.error('Minimalist failed to load its application entry.', error);
});
