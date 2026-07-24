import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCatalog,
  normalizeLocale,
  normalizeSearchText,
  resolveLocale,
  translate,
} from '../src/lib/i18n.js';
import { getLocalizedHelpItems } from '../src/content/helpContent.js';

test('locale resolution accepts regional browser preferences and falls back safely', () => {
  assert.equal(normalizeLocale('es-MX'), 'es');
  assert.equal(normalizeLocale('zh_CN'), 'zh-Hans');
  assert.equal(resolveLocale(['fr-FR', 'en-GB']), 'fr');
  assert.equal(resolveLocale(['fr-FR']), 'fr');
  assert.equal(resolveLocale(['xx-Unknown']), 'en');
});

test('every supported catalog has the same keys as English', () => {
  const englishKeys = Object.keys(getCatalog('en')).sort();
  assert.deepEqual(Object.keys(getCatalog('es')).sort(), englishKeys);
  assert.deepEqual(Object.keys(getCatalog('zh-Hans')).sort(), englishKeys);
});

test('translations interpolate values and unknown locales use English', () => {
  assert.equal(translate('help.results', { count: 3, total: 12 }, 'es'), 'Mostrando 3 de 12 respuestas');
  assert.equal(translate('help.heroTitle', {}, 'fr'), 'Helpful answers. No support maze.');
});

test('localized help keeps stable IDs and filtering topics', () => {
  const english = getLocalizedHelpItems('en');
  const spanish = getLocalizedHelpItems('es');
  const chinese = getLocalizedHelpItems('zh-Hans');
  assert.equal(english.length, 12);
  assert.deepEqual(spanish.map(({ id }) => id), english.map(({ id }) => id));
  assert.deepEqual(chinese.map(({ topicKey }) => topicKey), english.map(({ topicKey }) => topicKey));
  assert.match(spanish[0].question, /Minimalist/);
  assert.match(chinese[0].question, /Minimalist/);
  assert.doesNotMatch(spanish.find(({ id }) => id === 'paid-plan-costs').answer, /\{\w+\}/);
});

test('search normalization handles case and diacritics', () => {
  assert.equal(normalizeSearchText('FACTURACIÓN', 'es'), 'facturacion');
});
