let clockInterval = null;
let faviconInterval = null;
let faviconResetTimeout = null;

function updateClock() {
  const clockEl = document.getElementById('live-clock');
  if (!clockEl) return;

  clockEl.textContent = `SYSTEM TIME: ${new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })}`;
}

const openEyes = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='10' width='80' height='60' rx='25' fill='%23FFD700' stroke='%23000' stroke-width='8'/><path d='M 25 70 L 25 90 L 45 70 Z' fill='%23FFD700' stroke='%23000' stroke-width='8' stroke-linejoin='round'/><circle cx='35' cy='40' r='8' fill='%23000'/><circle cx='65' cy='40' r='8' fill='%23000'/></svg>";
const closedEyes = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='10' width='80' height='60' rx='25' fill='%23FFD700' stroke='%23000' stroke-width='8'/><path d='M 25 70 L 25 90 L 45 70 Z' fill='%23FFD700' stroke='%23000' stroke-width='8' stroke-linejoin='round'/><line x1='27' y1='40' x2='43' y2='40' stroke='%23000' stroke-width='6' stroke-linecap='round'/><line x1='57' y1='40' x2='73' y2='40' stroke='%23000' stroke-width='6' stroke-linecap='round'/></svg>";

function resetFavicon() {
  const favicon = document.getElementById('dynamic-favicon');
  if (favicon) favicon.href = openEyes;
}

function blinkFavicon() {
  const favicon = document.getElementById('dynamic-favicon');
  if (!favicon || document.hidden) return;

  favicon.href = closedEyes;
  clearTimeout(faviconResetTimeout);
  faviconResetTimeout = window.setTimeout(() => {
    faviconResetTimeout = null;
    resetFavicon();
  }, 150);
}

function stopCosmeticTimers() {
  clearInterval(clockInterval);
  clearInterval(faviconInterval);
  clearTimeout(faviconResetTimeout);
  clockInterval = null;
  faviconInterval = null;
  faviconResetTimeout = null;
  resetFavicon();
}

function startCosmeticTimers() {
  if (document.hidden || clockInterval || faviconInterval) return;
  updateClock();
  clockInterval = window.setInterval(updateClock, 1000);
  faviconInterval = window.setInterval(blinkFavicon, 4000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCosmeticTimers();
  else startCosmeticTimers();
});

window.addEventListener('pagehide', stopCosmeticTimers);
window.addEventListener('pageshow', startCosmeticTimers);
startCosmeticTimers();
