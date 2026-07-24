let loadedMarketingPagesModule = null;
let marketingPagesModulePromise = null;

export function loadMarketingPagesModule() {
  if (loadedMarketingPagesModule) return Promise.resolve(loadedMarketingPagesModule);

  if (!marketingPagesModulePromise) {
    marketingPagesModulePromise = import('../pages/MarketingPages.jsx')
      .then((module) => {
        loadedMarketingPagesModule = module;
        return module;
      })
      .catch((error) => {
        marketingPagesModulePromise = null;
        throw error;
      });
  }

  return marketingPagesModulePromise;
}

export function readMarketingPagesModule() {
  return loadedMarketingPagesModule;
}
