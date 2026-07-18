export function withTimeout(
  value,
  timeoutMs,
  {
    code = 'operation/timeout',
    message = 'The operation timed out.',
    scheduleTimeout = globalThis.setTimeout,
    cancelTimeout = globalThis.clearTimeout,
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError('A positive timeout is required.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle;

    const settle = (handler, result) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) cancelTimeout(timeoutHandle);
      handler(result);
    };

    timeoutHandle = scheduleTimeout(() => {
      const error = new Error(message);
      error.code = code;
      settle(reject, error);
    }, timeoutMs);

    Promise.resolve(value).then(
      (result) => settle(resolve, result),
      (error) => settle(reject, error),
    );
  });
}
