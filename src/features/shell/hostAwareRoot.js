import { createRoot } from 'react-dom/client';

export function createHostAwareRoot({
  rootFactory = createRoot,
  onAttach,
  onDetach,
} = {}) {
  let host = null;
  let root = null;

  function detach() {
    const previousHost = host;
    const previousRoot = root;
    host = null;
    root = null;

    try {
      previousRoot?.unmount();
    } finally {
      if (previousHost) onDetach?.(previousHost);
    }
  }

  function render(nextHost, node) {
    if (!nextHost) return false;

    if (!root || host !== nextHost) {
      detach();
      nextHost.replaceChildren();
      const nextRoot = rootFactory(nextHost);

      try {
        onAttach?.(nextHost);
      } catch (error) {
        nextRoot.unmount();
        throw error;
      }

      host = nextHost;
      root = nextRoot;
    }

    root.render(node);
    return true;
  }

  return {
    render,
    unmount: detach,
  };
}
