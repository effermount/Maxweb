'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { releaseNotes } = require('./release-notes.cjs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { normalizeRepository, verifyManifest } = require('../src/update-core.cjs');
const root = path.join(__dirname, '..');
const repo = normalizeRepository(require('../src/release-config.json').repository);
const { version } = require('../package.json');
const tag = `v${version}`;
const assets = [`Obla-${version}-universal.dmg`, `Obla-${version}-universal.zip`, 'latest-mac.json', 'latest.json'].map(name => path.join(root, 'dist', name));
for (const file of assets) if (!fs.existsSync(file)) throw new Error(`Сначала выполните npm run dist: отсутствует ${path.basename(file)}`);
const manifest = JSON.parse(fs.readFileSync(assets[2]));
const publicKey = fs.readFileSync(path.join(root, 'assets/release-public.pem'));
verifyManifest(manifest, publicKey, `https://github.com/${repo}/releases/download/${tag}/latest-mac.json`);
const legacy = JSON.parse(fs.readFileSync(assets[3]));
verifyManifest(legacy, publicKey, `https://github.com/${repo}/releases/download/${tag}/latest.json`, { arch: 'arm64' });
if (manifest.arch !== 'universal' || legacy.arch !== 'arm64' || ['version', 'url', 'size', 'sha256'].some(key => legacy[key] !== manifest[key]) || manifest.url !== path.basename(assets[1])) throw new Error('Описания Universal-выпуска и совместимого обновления не совпадают.');
if (manifest.version !== version) throw new Error('Версия выпуска не совпадает с package.json.');
const archive = fs.readFileSync(assets[1]);
if (archive.length !== manifest.size || createHash('sha256').update(archive).digest('hex') !== manifest.sha256) throw new Error('Архив не совпадает с подписанным описанием выпуска. Выполните npm run dist заново.');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git(['status', '--porcelain'])) throw new Error('Перед публикацией сохраните изменения в Git-коммите.');
const remote = git(['remote', 'get-url', 'origin']).replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
if (remote.toLowerCase() !== `https://github.com/${repo}`.toLowerCase()) throw new Error('Git remote origin не совпадает с репозиторием выпусков.');
const gh = process.env.MAXWEB_GH || 'gh';
const github = args => execFileSync(gh, args, { cwd: root, encoding: 'utf8' }).trim();
execFileSync(gh, ['auth', 'status'], { stdio: 'inherit' });
execFileSync('git', ['push', 'origin', 'main'], { cwd: root, stdio: 'inherit' });
const head = git(['rev-parse', 'HEAD']);
let tagged;
try { tagged = git(['rev-parse', '--verify', `refs/tags/${tag}^{}`]); } catch {}
if (tagged && tagged !== head) throw new Error('Этот тег уже указывает на другой коммит. Увеличьте версию.');
if (!tagged) execFileSync('git', ['tag', '-a', tag, '-m', `Обла ${version}`], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['push', 'origin', tag], { cwd: root, stdio: 'inherit' });
let release;
try { release = JSON.parse(github(['api', `repos/${repo}/releases/tags/${tag}`])); }
catch (error) { if (!String(error.stderr).includes('HTTP 404')) throw error; }
if (release && !release.draft) throw new Error('Этот релиз уже опубликован и не будет изменён. Увеличьте версию.');
const notesDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-release-'));
try {
  const notesFile = path.join(notesDirectory, 'notes.md');
  fs.writeFileSync(notesFile, releaseNotes(fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8'), version));
  if (!release) github(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--title', `Обла ${version}`, '--notes-file', notesFile]);
  else github(['release', 'edit', tag, '--repo', repo, '--notes-file', notesFile]);
} finally { fs.rmSync(notesDirectory, { recursive: true, force: true }); }
// Upload into a draft: clients never observe a partially uploaded release.
execFileSync(gh, ['release', 'upload', tag, ...assets, '--repo', repo, '--clobber'], { cwd: root, stdio: 'inherit' });
github(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest']);
console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
