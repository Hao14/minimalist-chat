import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPORTED_LOCALES,
  getCatalog,
  getLocaleDirection,
  normalizeLocale,
  translate,
} from '../src/lib/i18n.js';

const expectedLocales = [
  'en',
  'es',
  'zh-Hans',
  'fr',
  'de',
  'pt-BR',
  'ja',
  'ar',
  'hi',
];

const chatKeys = [
  'chat.composer.placeholder',
  'chat.send',
  'chat.unread.label',
  'chat.unread.jump',
  'chat.thread.title',
  'chat.thread.replyPlaceholder',
  'chat.schedule.title',
  'chat.schedule.confirm',
  'chat.translate.action',
  'chat.translate.showOriginal',
  'chat.report.action',
  'chat.report.submit',
  'chat.attachment.add',
  'chat.attachment.cancelUpload',
  'chat.status.sent',
  'chat.status.failed',
  'chat.status.retry',
];

test('supported interface locales include regional normalization and RTL metadata', () => {
  assert.deepEqual(SUPPORTED_LOCALES.map(({ code }) => code), expectedLocales);

  const cases = new Map([
    ['EN-gb', 'en'],
    ['es_MX', 'es'],
    ['zh_CN', 'zh-Hans'],
    ['fr-CA', 'fr'],
    ['de-AT', 'de'],
    ['pt_br', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['ja-JP', 'ja'],
    ['ar-EG', 'ar'],
    ['hi-IN', 'hi'],
  ]);
  for (const [candidate, expected] of cases) {
    assert.equal(normalizeLocale(candidate), expected, candidate);
  }

  assert.equal(getLocaleDirection('ar-SA'), 'rtl');
  for (const locale of expectedLocales.filter((locale) => locale !== 'ar')) {
    assert.equal(getLocaleDirection(locale), 'ltr', locale);
  }
});

test('every locale exposes a complete focused chat enhancement catalog', () => {
  const englishKeys = Object.keys(getCatalog('en')).sort();
  for (const locale of expectedLocales) {
    assert.deepEqual(Object.keys(getCatalog(locale)).sort(), englishKeys, locale);
    for (const key of chatKeys) {
      assert.equal(typeof getCatalog(locale)[key], 'string', `${locale}:${key}`);
      assert.ok(getCatalog(locale)[key].length > 0, `${locale}:${key}`);
    }
  }
});

test('new locale chat strings are native translations with interpolation intact', () => {
  const expectedSendLabels = new Map([
    ['es', 'Enviar'],
    ['zh-Hans', '发送'],
    ['fr', 'Envoyer'],
    ['de', 'Senden'],
    ['pt-BR', 'Enviar'],
    ['ja', '送信'],
    ['ar', 'إرسال'],
    ['hi', 'भेजें'],
  ]);
  for (const [locale, expected] of expectedSendLabels) {
    assert.equal(translate('chat.send', {}, locale), expected, locale);
  }

  assert.equal(
    translate('chat.unread.count', { count: 7 }, 'ar'),
    '7 رسائل غير مقروءة',
  );
  assert.equal(
    translate('chat.composer.placeholder', { channel: 'general' }, 'ja'),
    '#general にメッセージを送信',
  );
});
