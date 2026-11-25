const { test } = require('node:test');
const assert = require('node:assert/strict');
const { avatarURL, fetchAvatarBytes } = require('../src/avatar.cjs');

test('avatar fallback accepts only HTTPS image hosts of the account service', () => {
  assert(avatarURL('https://cdn.max.ru/photo', 'max'));
  assert(avatarURL('https://pps.whatsapp.net/photo', 'whatsapp'));
  assert(avatarURL('https://sun.userapi.com/photo', 'vk'));
  for (const url of ['http://cdn.max.ru/a', 'https://cdn.max.ru.evil.test/a', 'https://user:pass@cdn.max.ru/a', 'https://cdn.max.ru:444/a', 'https://127.0.0.1/a', 'file:///tmp/a']) {
    assert.equal(avatarURL(url, 'max'), false, url);
  }
  assert.equal(avatarURL('https://cdn.max.ru/a', 'whatsapp'), false);
});

test('avatar fallback reads bounded bytes without cookies and rejects unsafe redirects before fetching', async () => {
  let calls = 0;
  const bytes = await fetchAvatarBytes('https://cdn.max.ru/a', 'max', async (_url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual');
    return new Response(new Uint8Array([1, 2, 3]));
  });
  assert.deepEqual([...bytes], [1, 2, 3]);
  await assert.rejects(fetchAvatarBytes('https://cdn.max.ru/a', 'max', async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
  }), /Unexpected avatar origin/);
  assert.equal(calls, 1);
  await assert.rejects(fetchAvatarBytes('https://cdn.max.ru/a', 'max', async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1))), /too large/);
  await assert.rejects(fetchAvatarBytes('https://cdn.max.ru/a', 'max', async () => new Response(null, { status: 403 })), /HTTP 403/);
});
