import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { VaultPanel } from './Vault.jsx';

let vaultRoot = null;

export function mountVault(props) {
  const host = document.getElementById('vault-root');
  if (!host) return;

  if (!vaultRoot) {
    host.replaceChildren();
    vaultRoot = createRoot(host);
  }

  vaultRoot.render(createElement(VaultPanel, props));
}
