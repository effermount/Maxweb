const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const { compareVersions, normalizeRepository, canonicalManifest, verifyManifest, downloadVerified, githubRelease } = require('../src/update-core.cjs');
const { Updater } = require('../src/updater.cjs');
const keys = generateKeyPairSync('ed25519');
function signed(data = Buffer.from('release archive'), extra = {}) {
  const manifest = { schema: 1, version: '1.2.0', platform: 'darwin', arch: 'arm64', url: 'Maxweb.zip', size: data.length, sha256: createHash('sha256').update(data).digest('hex'), publishedAt: '2026-11-20T10:00:00.000Z', notes: 'Release notes', ...extra };
  manifest.signature = sign(null, canonicalManifest(manifest), keys.privateKey).toString('base64');
  return manifest;
}
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-updates-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('version ordering prevents lexicographic errors, reinstall and downgrade', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.1.0', '1.1.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
  assert.throws(() => compareVersions('1.0.0-beta', '1.0.0'));
});
test('only explicit GitHub repositories are accepted', () => {
  assert.equal(normalizeRepository('https://github.com/user/Maxweb.git'), 'user/Maxweb');
  for (const repo of ['https://evil.test/user/Maxweb', 'https://github.com/user/Maxweb?token=x', 'user/../etc', 'user/..', '/user/Maxweb', 'user/Maxweb/releases']) assert.throws(() => normalizeRepository(repo), repo);
});
test('release signature binds version, architecture, download URL and checksum', () => {
  const manifest = signed();
  const url = 'https://github.com/user/Maxweb/releases/download/v1.2.0/latest.json';
  assert.equal(verifyManifest(manifest, keys.publicKey, url).downloadURL, 'https://github.com/user/Maxweb/releases/download/v1.2.0/Maxweb.zip');
  for (const patch of [{ version: '9.0.0' }, { sha256: '0'.repeat(64) }, { url: 'https://evil.test/trojan.zip' }, { notes: 'altered' }]) assert.throws(() => verifyManifest({ ...manifest, ...patch }, keys.publicKey, url), /Подпись/);
  const other = generateKeyPairSync('ed25519');
  assert.throws(() => verifyManifest(manifest, other.publicKey, url), /Подпись/);
  assert.throws(() => verifyManifest(signed(undefined, { url: 'http://example.com/app.zip' }), keys.publicKey, url), /HTTPS/);
  assert.throws(() => verifyManifest(signed(undefined, { arch: 'x64' }), keys.publicKey, url), /Apple Silicon/);
});
test('download validates bytes, rejects tampering and removes incomplete files', async t => {
  const dir = temp(t), body = Buffer.from('signed release');
  const source = path.join(dir, 'Maxweb.zip'), target = path.join(dir, 'download.zip');
  fs.writeFileSync(source, body);
  const manifest = verifyManifest(signed(body), keys.publicKey, pathToFileURL(path.join(dir, 'latest.json')), { allowFile: true });
  const progress = [];
  await downloadVerified(manifest, target, { allowFile: true, onProgress: n => progress.push(n) });
  assert.deepEqual(fs.readFileSync(target), body); assert.equal(progress.at(-1), 100);
  fs.writeFileSync(source, Buffer.from('corrupt bytes!'));
  await assert.rejects(downloadVerified(manifest, target + '.bad', { allowFile: true }), /SHA-256|размер/);
  assert.equal(fs.existsSync(target + '.bad'), false);
  assert.equal(fs.existsSync(target + '.bad.part'), false);
});
test('GitHub release discovery follows only HTTPS redirects and uses signed asset', async () => {
  const manifest = signed();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url); assert.equal(options.credentials, 'omit');
    if (url.endsWith('/releases/latest')) return Response.json({ assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/user/Maxweb/releases/download/v1.2.0/latest.json' }] });
    return Response.json(manifest);
  };
  const found = await githubRelease('user/Maxweb', { fetchImpl });
  assert.equal(found.manifest.version, '1.2.0'); assert.equal(calls.length, 2);
  await assert.rejects(githubRelease('user/Maxweb', { fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://insecure.test/' } }) }), /Небезопасный/);
});
test('updater reaches ready only after signed download and never downloads older releases', async t => {
  const dir = temp(t), body = Buffer.from('signed release');
  fs.writeFileSync(path.join(dir, 'Maxweb.zip'), body);
  const manifest = signed(body);
  const feed = path.join(dir, 'latest.json'); fs.writeFileSync(feed, JSON.stringify(manifest));
  const states = [];
  const updater = new Updater({ version: '1.1.0', directory: path.join(dir, 'cache'), publicKey: keys.publicKey, getSettings: () => ({ repository: '' }), onChange: state => states.push(state.status) });
  assert.equal((await updater.check()).status, 'unconfigured');
  assert.equal((await updater.check(pathToFileURL(feed))).status, 'available');
  assert.equal((await updater.download()).status, 'ready');
  assert.ok(states.includes('downloading'));
  await assert.rejects(updater.install(), /Программах/);
  const current = new Updater({ version: '1.2.0', directory: dir, publicKey: keys.publicKey, getSettings: () => ({}) });
  assert.equal((await current.check(pathToFileURL(feed))).status, 'current');
  await assert.rejects(current.download(), /Сначала/);
});

test('update network requests retry a transient failure once and preserve safe redirect options', async () => {
  const { readJSON } = require('../src/update-core.cjs');
  let calls = 0;
  const value = await readJSON('https://github.com/example/latest.json', { fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    if (++calls === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
    return Response.json({ version: '1.2.5' });
  } });
  assert.equal(value.version, '1.2.5');
  assert.equal(calls, 2);
});
test('update network errors are readable, bounded, and do not retry TLS, timeout or HTTP failures', async () => {
  const { readJSON } = require('../src/update-core.cjs');
  for (const [code, expected, count] of [['ECONNRESET', /интернет-соединение/, 2], ['CERT_HAS_EXPIRED', /дату и время/, 1], ['ETIMEDOUT', /не ответил вовремя/, 1]]) {
    let calls = 0;
    await assert.rejects(readJSON('https://github.com/example/latest.json', { fetchImpl: async () => {
      calls++;
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('network'), { code }) });
    } }), expected);
    assert.equal(calls, count);
  }
  let calls = 0;
  await assert.rejects(readJSON('https://github.com/example/latest.json', { fetchImpl: async () => { calls++; return new Response(null, { status: 403 }); } }), /ограничил запросы/);
  assert.equal(calls, 1);
});
