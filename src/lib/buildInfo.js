function normalizeBuildPart(value, fallback) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

const buildEnvironment = import.meta.env ?? {};

export const APP_VERSION = normalizeBuildPart(
  buildEnvironment.VITE_APP_VERSION,
  '0.0.0',
);

export const APP_BUILD_NUMBER = normalizeBuildPart(
  buildEnvironment.VITE_APP_BUILD_NUMBER,
  'local',
);

export const APP_BUILD_LABEL = `${APP_VERSION} · ${APP_BUILD_NUMBER}`;
