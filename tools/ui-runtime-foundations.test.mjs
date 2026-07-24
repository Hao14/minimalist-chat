import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { readableAccentForeground } from '../src/features/settings/themeRuntime.js';

function relativeLuminance(hexColor) {
  const value = hexColor.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(firstColor, secondColor) {
  const first = relativeLuminance(firstColor);
  const second = relativeLuminance(secondColor);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function classListStub() {
  const values = new Set();
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    contains(name) {
      return values.has(name);
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, force) {
      if (force === undefined ? !values.has(name) : force) values.add(name);
      else values.delete(name);
    },
  };
}

function createVaultShareLoaderContext() {
  const insertedStylesheets = [];
  const featurePlaceholder = {
    crossOrigin: '',
    href: '',
    media: '',
    parentNode: {
      insertBefore(stylesheet) {
        insertedStylesheets.push(stylesheet);
        stylesheet.isConnected = true;
        stylesheet.onload?.();
      },
    },
    getAttribute(name) {
      return {
        'data-css-lazy': 'feature',
        'data-css-scope': 'app',
        'data-href': '/features.css?v=48',
      }[name] ?? null;
    },
    remove() {
      this.isConnected = false;
    },
  };
  const documentElement = { classList: classListStub() };
  const document = {
    documentElement,
    head: {
      appendChild(stylesheet) {
        insertedStylesheets.push(stylesheet);
        stylesheet.isConnected = true;
        stylesheet.onload?.();
      },
    },
    readyState: 'loading',
    createElement(tagName) {
      if (tagName === 'script') return { noModule: false };
      return {
        addEventListener() {},
        appendChild() {},
        classList: classListStub(),
        remove() {},
        removeAttribute() {},
        setAttribute() {},
      };
    },
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-load-css]' ? [featurePlaceholder] : [];
    },
  };
  const localStorage = { getItem: () => null };
  const navigator = {};
  const window = {
    document,
    localStorage,
    location: { pathname: '/vault/share/example' },
    matchMedia() {
      return {
        matches: false,
        addEventListener() {},
      };
    },
    navigator,
    addEventListener() {},
    removeEventListener() {},
    clearTimeout() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    setTimeout() {
      return 1;
    },
  };
  window.window = window;

  return {
    context: {
      document,
      localStorage,
      navigator,
      window,
    },
    insertedStylesheets,
  };
}

test('vault share startup converts the feature stylesheet placeholder', async () => {
  const source = await readFile(new URL('../public/load-css.js', import.meta.url), 'utf8');
  const { context, insertedStylesheets } = createVaultShareLoaderContext();

  vm.runInNewContext(source, context, { filename: 'public/load-css.js' });
  await context.window.__minimalistDeferredCssReady;

  assert.deepEqual(
    insertedStylesheets.map((stylesheet) => stylesheet.href),
    ['/features.css?v=48'],
  );
});

test('custom accent foreground remains WCAG AA-safe at contrast boundaries', () => {
  for (const accent of ['#000000', '#767676', '#ed2135', '#ffffff', '#FFD700']) {
    const foreground = readableAccentForeground(accent);
    assert.ok(
      contrastRatio(accent, foreground) >= 4.5,
      `${accent} with ${foreground} must meet the 4.5:1 text contrast threshold.`,
    );
  }
});
