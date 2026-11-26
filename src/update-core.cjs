'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createHash, verify } = require('node:crypto');

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_ARCHIVE = 2 * 1024 * 1024 * 1024;
function compareVersions(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) throw new Error('Поддерживаются версии вида 1.2.3.');
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}
function normalizeRepository(value) {
  let repo = String(value || '').trim();
  if (repo.startsWith('https://github.com/')) {
    const url = new URL(repo);
    if (url.search || url.hash || url.username || url.password) throw new Error('Укажите GitHub-репозиторий в формате owner/Obla.');
    repo = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  repo = repo.replace(/\.git$/, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(repo) || ['.', '..'].includes(repo.split('/')[1])) {
    throw new Error('Укажите GitHub-репозиторий в формате owner/Obla.');
  }
  return repo;
}
function payload(manifest) {
  return {
    schema: manifest.schema, version: manifest.version, platform: manifest.platform,
    arch: manifest.arch, url: manifest.url, size: manifest.size,
    sha256: manifest.sha256, publishedAt: manifest.publishedAt, notes: manifest.notes
  };
}
function canonicalManifest(manifest) { return Buffer.from(JSON.stringify(payload(manifest)), 'utf8'); }
function supportsMacArchitecture(releaseArch, arch = process.arch) {
  return ['arm64', 'x64'].includes(arch) && (releaseArch === arch || releaseArch === 'universal');
}
function matchesMacBinary(architectures, releaseArch, arch = process.arch) {
  const slices = new Set(architectures.trim().split(/\s+/));
  return supportsMacArchitecture(releaseArch, arch) && slices.has(arch === 'x64' ? 'x86_64' : 'arm64') &&
    (releaseArch !== 'universal' || slices.has('arm64') && slices.has('x86_64'));
}
function verifyManifest(manifest, publicKey, baseURL, { allowFile = false, arch = process.arch, platform = 'darwin', requireCompatible = true } = {}) {
  const validArchitecture = platform === 'darwin'
    ? ['arm64', 'x64', 'universal'].includes(manifest?.arch) && (!requireCompatible || supportsMacArchitecture(manifest.arch, arch))
    : platform === 'win32' && ['x64', 'arm64'].includes(manifest?.arch) && (!requireCompatible || manifest.arch === arch);
  if (!manifest || manifest.schema !== 1 || !VERSION.test(manifest.version) || manifest.platform !== platform || !validArchitecture) throw new Error(platform === 'win32' ? 'Этот выпуск не предназначен для архитектуры этой Windows.' : 'Этот выпуск не предназначен для архитектуры этого Mac.');
  if (!Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > MAX_ARCHIVE || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Некорректная контрольная сумма или размер обновления.');
  if (typeof manifest.notes !== 'string' || manifest.notes.length > 12000 || typeof manifest.publishedAt !== 'string' || !Number.isFinite(Date.parse(manifest.publishedAt)) || typeof manifest.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature)) throw new Error('Некорректное описание обновления.');
  if (!verify(null, canonicalManifest(manifest), publicKey, Buffer.from(manifest.signature, 'base64'))) throw new Error('Подпись обновления не совпадает. Установка отменена.');
  if (typeof manifest.url !== 'string' || manifest.url.length > 2048) throw new Error('Некорректный адрес обновления.');
  const url = new URL(manifest.url, baseURL);
  const base = new URL(baseURL);
  if (platform === 'win32' && !url.pathname.toLowerCase().endsWith('.exe')) throw new Error('Обновление Windows должно содержать установщик EXE.');
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' || allowFile && base.protocol === 'file:' && url.protocol === 'file:' && path.dirname(fileURLToPath(url)) === path.dirname(fileURLToPath(base)))) throw new Error('Обновления разрешены только по HTTPS или из выбранной локальной папки.');
  return { ...payload(manifest), signature: manifest.signature, downloadURL: url.href };
}
async function fetchResource(fetchImpl, url, timeout) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchImpl(url, {
        headers: { 'User-Agent': 'Maxweb-Updater', Accept: 'application/vnd.github+json, application/json, application/octet-stream' },
        redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeout)
      });
    } catch (error) {
      const code = error.cause?.code || error.code || '';
      const timedOut = ['TimeoutError', 'AbortError'].includes(error.name) || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code);
      const transient = ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET'].includes(code) || (!code && error.message === 'fetch failed');
      if (!attempt && transient && !timedOut) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      const message = timedOut
        ? 'Сервер обновлений не ответил вовремя. Повторите проверку позже.'
        : /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)
          ? 'Не удалось проверить защищённое соединение с сервером обновлений. Проверьте дату и время на компьютере и настройки сети.'
          : 'Не удалось подключиться к серверу обновлений. Проверьте интернет-соединение и настройки VPN или прокси, затем повторите попытку.';
      throw new Error(message, { cause: error });
    }
  }
}
async function resource(urlValue, { fetchImpl = fetch, allowFile = false, timeout = 30000 } = {}) {
  let url = new URL(urlValue);
  if (allowFile && url.protocol === 'file:') return { body: fs.createReadStream(fileURLToPath(url)), headers: new Map() };
  for (let redirects = 0; redirects <= 6; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Небезопасный адрес сервера обновлений.');
    const response = await fetchResource(fetchImpl, url.href, timeout);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Сервер вернул пустой адрес перенаправления.');
      url = new URL(location, url); continue;
    }
    if (response.status === 404) throw new Error('Релиз ещё не опубликован или репозиторий недоступен.');
    if (response.status === 403 || response.status === 429) throw new Error('GitHub временно ограничил запросы. Попробуйте позже.');
    if (!response.ok) throw new Error(`Сервер обновлений вернул HTTP ${response.status}.`);
    return response;
  }
  throw new Error('Слишком много перенаправлений при загрузке обновления.');
}
async function readJSON(url, options) {
  const response = await resource(url, options);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Описание обновления превышает допустимый размер.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function githubRelease(repository, options = {}) {
  const repo = normalizeRepository(repository);
  const release = await readJSON(`https://api.github.com/repos/${repo}/releases/latest`, options);
  if (release.draft || release.prerelease) throw new Error('Стабильный выпуск ещё не опубликован.');
  // Existing ARM64 clients use latest.json; new clients prefer an explicitly
  // Universal manifest, falling back when checking releases made before it existed.
  const asset = options.platform === 'win32'
    ? release.assets?.find(item => item.name === 'latest-windows.json')
    : release.assets?.find(item => item.name === 'latest-mac.json') || release.assets?.find(item => item.name === 'latest.json');
  if (!asset?.browser_download_url?.startsWith(`https://github.com/${repo}/releases/download/`)) throw new Error(`В релизе отсутствует подписанный файл ${options.platform === 'win32' ? 'latest-windows.json' : 'latest.json'}.`);
  return { manifest: await readJSON(asset.browser_download_url, options), manifestURL: asset.browser_download_url };
}
async function downloadVerified(manifest, destination, options = {}) {
  const partial = `${destination}.part`;
  const hash = createHash('sha256'); let size = 0;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let file;
  try {
    const response = await resource(manifest.downloadURL, { ...options, timeout: 10 * 60 * 1000 });
    const length = Number(response.headers.get('content-length'));
    if (length && length !== manifest.size) throw new Error('Размер файла не совпадает с описанием выпуска.');
    file = await fs.promises.open(partial, 'w', 0o600);
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > manifest.size) throw new Error('Обновление превышает ожидаемый размер.');
      hash.update(chunk);
      // FileHandle.write may write only part of a buffer.
      const buffer = Buffer.from(chunk);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset);
        if (!bytesWritten) throw new Error('Не удалось записать обновление на диск.');
        offset += bytesWritten;
      }
      options.onProgress?.(Math.floor(size * 100 / manifest.size));
    }
    if (size !== manifest.size || hash.digest('hex') !== manifest.sha256) throw new Error('Проверка SHA-256 не пройдена. Повреждённый файл удалён.');
    await file.sync(); await file.close(); file = null;
    await fs.promises.rename(partial, destination);
    return destination;
  } catch (error) {
    await file?.close().catch(() => {});
    await fs.promises.rm(partial, { force: true });
    throw error;
  }
}
module.exports = { compareVersions, normalizeRepository, canonicalManifest, verifyManifest, readJSON, githubRelease, downloadVerified, supportsMacArchitecture, matchesMacBinary };
