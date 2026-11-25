'use strict';
const { serviceInfo } = require('./services.cjs');

const HOSTS = {
  max: ['max.ru', 'oneme.ru', 'okcdn.ru', 'mycdn.me'],
  whatsapp: ['whatsapp.net', 'whatsapp.com', 'fbcdn.net'],
  vk: ['vk.me', 'vk.ru', 'vk.com', 'userapi.com', 'vkuserphoto.ru', 'vkuserphoto.com']
};
function avatarURL(value, service) {
  try {
    if (typeof value !== 'string' || value.length > 8192) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      (HOSTS[service] || []).some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

// No browser cookies or credentials. Validate every redirect before requesting it.
async function fetchAvatarBytes(source, service, fetchImpl = globalThis.fetch) {
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!avatarURL(source, service)) throw new Error('Unexpected avatar origin');
    const response = await fetchImpl(source, { redirect: 'manual', credentials: 'omit', signal,
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5', Referer: serviceInfo(service).url } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const target = response.headers.get('location');
      if (!target) throw new Error('Missing avatar redirect');
      source = new URL(target, source).href;
      continue;
    }
    if (!response.ok || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) {
      await response.body?.cancel();
      throw new Error(response.ok ? 'Avatar too large' : `Avatar HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty avatar');
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Avatar too large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!size) throw new Error('Empty avatar');
    return new Uint8Array(Buffer.concat(chunks));
  }
  throw new Error('Too many avatar redirects');
}

module.exports = { avatarURL, fetchAvatarBytes };
