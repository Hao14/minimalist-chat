const VALID_STATES = new Set(['connecting', 'online', 'offline']);
const listeners = new Set();
let connectionState = 'connecting';

export function getDatabaseConnectionState() {
  return connectionState;
}

export function setDatabaseConnectionState(nextState) {
  const normalized = VALID_STATES.has(nextState) ? nextState : 'offline';
  if (normalized === connectionState) return connectionState;
  connectionState = normalized;
  listeners.forEach((listener) => listener());
  return connectionState;
}

export function subscribeDatabaseConnection(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
