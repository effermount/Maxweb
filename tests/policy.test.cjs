const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isMaxURL, isExternalURL, mayUsePermission, unreadBadge } = require('../src/policy.cjs');

test('MAX origin cannot be bypassed with lookalike hosts, credentials or insecure URLs', () => {
  assert.ok(isMaxURL('https://web.max.ru/chats/123'));
  for (const url of ['http://web.max.ru/', 'https://web.max.ru.evil.test', 'https://web.max.ru@evil.test', 'https://evil.test/?web.max.ru', 'file:///tmp/max', 'javascript:alert(1)', 'https://web.max.ru:444']) {
    assert.equal(isMaxURL(url), false, url);
  }
});
test('external links cannot launch local files, scripts, or custom native schemes', () => {
  for (const url of ['https://max.ru/', 'https://example.com', 'mailto:test@example.com', 'tel:+70000000000']) assert.ok(isExternalURL(url));
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'myapp://execute', 'not a URL']) assert.equal(isExternalURL(url), false);
});
test('permission requires both the requesting frame and top-level page to be MAX', () => {
  assert.ok(mayUsePermission('notifications', 'https://web.max.ru', 'https://web.max.ru/chats'));
  assert.equal(mayUsePermission('notifications', 'https://web.max.ru', 'https://web.max.ru', false), false);
  assert.equal(mayUsePermission('notifications', 'https://evil.test', 'https://web.max.ru'), false);
  assert.equal(mayUsePermission('media', 'https://web.max.ru', 'file:///settings.html'), false);
  for (const permission of ['geolocation', 'clipboard-read', 'display-capture', 'fileSystem', 'unknown']) assert.equal(mayUsePermission(permission, 'https://web.max.ru', 'https://web.max.ru'), false);
});
test('unread badge does not mistake numbers inside chat names for unread counts', () => {
  assert.equal(unreadBadge('(12) MAX'), '12');
  assert.equal(unreadBadge('(120) MAX'), '99+');
  assert.equal(unreadBadge('1 непрочитанный чат'), '1');
  assert.equal(unreadBadge('23 непрочитанных чата'), '23');
  assert.equal(unreadBadge('120 непрочитанных чатов'), '99+');
  assert.equal(unreadBadge('12 unread chats'), '12');
  assert.equal(unreadBadge('(0) MAX'), '');
  assert.equal(unreadBadge('Группа (123)'), '');
});


test('Telegram origins and permissions stay within the selected messenger', () => {
  const { isServiceURL, isTelegramURL } = require('../src/policy.cjs');
  assert.ok(isTelegramURL('https://web.telegram.org/k/#123'));
  for (const url of ['http://web.telegram.org/k/', 'https://web.telegram.org.evil.test/k/', 'https://web.telegram.org@evil.test/', 'https://evil@web.telegram.org/k/', 'https://web.telegram.org:444/k/', 'https://t.me/test']) assert.equal(isTelegramURL(url), false);
  assert.equal(isServiceURL('https://web.max.ru/', 'telegram'), false);
  assert.equal(isServiceURL('https://web.telegram.org/k/', 'max'), false);
  assert.ok(mayUsePermission('media', 'https://web.telegram.org', 'https://web.telegram.org/k/', true, 'telegram'));
  assert.equal(mayUsePermission('notifications', 'https://web.telegram.org', 'https://web.telegram.org/k/', false, 'telegram'), false);
  assert.equal(mayUsePermission('media', 'https://web.max.ru', 'https://web.telegram.org/k/', true, 'telegram'), false);
  assert.equal(mayUsePermission('media', 'https://web.telegram.org', 'file:///settings.html', true, 'telegram'), false);
});


test('WhatsApp origin, requesting frames and permissions are isolated', () => {
  const { isWhatsAppURL, isServiceURL } = require('../src/policy.cjs');
  assert.ok(isWhatsAppURL('https://web.whatsapp.com/'));
  for (const url of ['http://web.whatsapp.com/', 'https://web.whatsapp.com.evil.test/', 'https://web.whatsapp.com@evil.test/', 'https://evil@web.whatsapp.com/', 'https://web.whatsapp.com:444/', 'https://wa.me/123']) assert.equal(isWhatsAppURL(url), false);
  assert.equal(isServiceURL('https://web.whatsapp.com/', 'telegram'), false);
  assert.ok(mayUsePermission('media', 'https://web.whatsapp.com', 'https://web.whatsapp.com/', true, 'whatsapp'));
  assert.equal(mayUsePermission('notifications', 'https://web.whatsapp.com', 'https://web.whatsapp.com/', false, 'whatsapp'), false);
  assert.equal(mayUsePermission('media', 'https://web.telegram.org', 'https://web.whatsapp.com/', true, 'whatsapp'), false);
  assert.equal(mayUsePermission('media', 'https://web.whatsapp.com', 'file:///settings.html', true, 'whatsapp'), false);
});
