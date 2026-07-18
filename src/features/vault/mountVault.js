import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import { VaultPanel } from './Vault.jsx';

const vaultRoot = createHostAwareRoot();

export function mountVault(props) {
  const host = document.getElementById('vault-root');
  if (!host) return;
  vaultRoot.render(host, createElement(VaultPanel, props));
}
