export const FIRST_CHAT_BOOT_MIN_MS = 900;
export const WARM_CHAT_BOOT_MIN_MS = 120;
export const CHAT_BOOT_READY_TIMEOUT_MS = 2500;

export function isChatBootReadyStatus(status) {
  return status === 'ready';
}

export function waitForChatBootReadiness({
  readiness,
  minimumMs = FIRST_CHAT_BOOT_MIN_MS,
  maximumMs = CHAT_BOOT_READY_TIMEOUT_MS,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
} = {}) {
  const minimumDelay = Math.max(0, Number(minimumMs) || 0);
  const maximumDelay = Math.max(0, Number(maximumMs) || 0);

  const minimumReady = new Promise((resolve) => {
    setTimer(resolve, minimumDelay);
  });

  const readinessResult = new Promise((resolve) => {
    let settled = false;
    let timeoutTimer;

    const finish = (status) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer !== undefined) clearTimer(timeoutTimer);
      resolve(status);
    };

    timeoutTimer = setTimer(() => finish('timeout'), maximumDelay);
    Promise.resolve(readiness).then(
      (value) => finish(value === false ? 'degraded' : 'ready'),
      () => finish('degraded'),
    );
  });

  return Promise.all([readinessResult, minimumReady]).then(([status]) => status);
}
