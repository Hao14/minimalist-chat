export async function startServiceWorkerRuntime({ buildNumber, entrypoint } = {}) {
  if (!('serviceWorker' in navigator)) return;

  const build = String(buildNumber || 'local')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 80);
  const mainEntrypoint = String(entrypoint || '');
  let registration = null;
  const watchedInstallers = new WeakSet();

  const signalCurrentWorker = () => {
    const workers = new Set([
      navigator.serviceWorker.controller,
      registration?.active,
      registration?.waiting,
    ]);
    workers.delete(null);
    workers.delete(undefined);
    workers.forEach((worker) => {
      worker.postMessage({
        type: 'minimalist:service-worker-build-ready',
        build,
        entrypoint: mainEntrypoint,
      });
    });
  };

  const watchInstaller = (worker) => {
    if (!worker || watchedInstallers.has(worker)) return;
    watchedInstallers.add(worker);
    const handleStateChange = () => {
      if (worker.state === 'installed' || worker.state === 'activated') signalCurrentWorker();
      if (worker.state === 'installed' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', handleStateChange);
      }
    };
    worker.addEventListener('statechange', handleStateChange);
  };

  navigator.serviceWorker.addEventListener('controllerchange', signalCurrentWorker);
  window.addEventListener('focus', signalCurrentWorker);
  window.addEventListener('pageshow', signalCurrentWorker);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) signalCurrentWorker();
  });

  registration = await navigator.serviceWorker.register(
    `/sw.js?build=${encodeURIComponent(build)}`,
    { updateViaCache: 'none' },
  );
  registration.addEventListener('updatefound', () => watchInstaller(registration.installing));
  watchInstaller(registration.installing);
  signalCurrentWorker();
}
