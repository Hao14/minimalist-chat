export function renderDeferredListImportError(error, {
  hostId,
  label,
  retryArgs,
  retryName,
}) {
  console.error(`${label} module failed to load.`, error);
  const host = document.getElementById(hostId);
  if (!host) return;

  const state = document.createElement('li');
  state.className = 'activity-state activity-state-error';
  state.setAttribute('role', 'alert');

  const iconWrap = document.createElement('span');
  iconWrap.className = 'activity-state-icon';
  iconWrap.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('i');
  icon.className = 'ph-bold ph-cloud-slash';
  iconWrap.append(icon);

  const title = document.createElement('strong');
  title.textContent = `Couldn't open ${label}`;
  const message = document.createElement('p');
  message.textContent = navigator.onLine === false
    ? `Reconnect, then try ${label} again.`
    : `${label} did not finish loading. You can retry without closing Updates.`;

  const actions = document.createElement('div');
  actions.className = 'activity-state-actions';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => {
    retry.disabled = true;
    retry.textContent = 'Retrying…';
    window[retryName]?.(retryArgs);
  });

  actions.append(retry);
  state.append(iconWrap, title, message, actions);
  host.setAttribute('aria-busy', 'false');
  host.replaceChildren(state);
}
