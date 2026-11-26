'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile, spawn } = require('node:child_process');
const { compareVersions, normalizeRepository, verifyManifest, githubRelease, readJSON, downloadVerified, matchesMacBinary, supportsMacArchitecture } = require('./update-core.cjs');
const run = promisify(execFile);

class Updater {
  constructor({ version, directory, publicKey, getSettings, onChange, fetchImpl, packaged = false, executable = process.execPath, bundleId = 'local.maxweb.desktop', beforeInstall = async () => {}, quit = () => {}, arch = process.arch, platform = 'darwin' }) {
    Object.assign(this, { version, directory, publicKey, getSettings, onChange, fetchImpl, packaged, executable, bundleId, beforeInstall, quit, arch, platform });
    this.state = { status: 'idle', currentVersion: version, progress: 0, message: 'Проверьте наличие новой версии.' };
    this.candidate = null;
    this.archive = null;
    this.busy = false;
    this.installing = false;
  }
  snapshot() { return structuredClone(this.state); }
  set(patch) { this.state = { ...this.state, ...patch }; this.onChange?.(this.snapshot()); return this.snapshot(); }
  reset() {
    if (this.busy || this.installing) throw new Error('Дождитесь завершения текущего обновления.');
    this.candidate = null; this.archive = null;
    return this.set({ status: 'idle', version: null, notes: '', progress: 0, message: 'Источник обновлений сохранён.' });
  }
  async check(sourceOverride) {
    if (this.busy || this.installing || this.state.status === 'ready') return this.snapshot();
    const settings = this.getSettings();
    if (!sourceOverride && !settings.repository) return this.set({ status: 'unconfigured', message: 'Укажите публичный репозиторий GitHub для обновлений.' });
    this.busy = true;
    this.set({ status: 'checking', message: 'Проверяем GitHub Releases…', progress: 0 });
    try {
      const options = { fetchImpl: this.fetchImpl, platform: this.platform };
      const release = sourceOverride
        ? { manifest: await readJSON(sourceOverride, { ...options, allowFile: true }), manifestURL: sourceOverride }
        : await githubRelease(normalizeRepository(settings.repository), options);
      // Authenticate even old releases for another Mac architecture. They are
      // harmless when already older; only a compatible newer one can be offered.
      const manifest = verifyManifest(release.manifest, this.publicKey, release.manifestURL, { allowFile: !!sourceOverride, platform: this.platform, requireCompatible: false });
      if (compareVersions(manifest.version, this.version) <= 0) {
        this.candidate = null;
        return this.set({ status: 'current', version: null, notes: '', message: `Установлена актуальная версия ${this.version}.`, checkedAt: new Date().toISOString() });
      }
      if (this.platform === 'win32' ? manifest.arch !== this.arch : !supportsMacArchitecture(manifest.arch, this.arch)) throw new Error('Этот выпуск не предназначен для архитектуры этого компьютера.');
      this.candidate = manifest;
      return this.set({ status: 'available', version: manifest.version, notes: manifest.notes, message: `Доступна версия ${manifest.version}.`, checkedAt: new Date().toISOString() });
    } catch (error) {
      this.set({ status: 'error', message: error.message });
      throw error;
    } finally { this.busy = false; }
  }
  async download() {
    if (this.busy || this.installing) return this.snapshot();
    if (!this.candidate || !['available', 'error'].includes(this.state.status)) throw new Error('Сначала проверьте наличие новой версии.');
    this.busy = true;
    this.set({ status: 'downloading', progress: 0, message: `Загружаем «Обла» ${this.candidate.version}…` });
    try {
      const filename = this.platform === 'win32' ? `Obla-${this.candidate.version}-windows-${this.arch}.exe` : `Maxweb-${this.candidate.version}.zip`;
      this.archive = await downloadVerified(this.candidate, path.join(this.directory, filename), {
        fetchImpl: this.fetchImpl, allowFile: this.candidate.downloadURL.startsWith('file:'),
        onProgress: progress => { if (progress !== this.state.progress) this.set({ progress }); }
      });
      return this.set({ status: 'ready', progress: 100, message: `Версия ${this.candidate.version} проверена и готова к установке.` });
    } catch (error) { this.set({ status: 'error', message: error.message }); throw error; }
    finally { this.busy = false; }
  }
  async install() {
    if (this.installing || this.busy) return this.snapshot();
    if (!this.packaged) throw new Error('Обновление устанавливается из приложения в «Программах».');
    if (this.state.status !== 'ready' || !this.candidate || !this.archive) throw new Error('Сначала скачайте и проверьте обновление.');
    this.installing = true;
    this.set({ status: 'installing', message: 'Подготавливаем установку. Приложение перезапустится…' });
    let work;
    try {
      const target = path.resolve(path.dirname(this.executable), '../..');
      if (path.basename(target) !== 'Maxweb.app' || (await fs.promises.lstat(target)).isSymbolicLink()) throw new Error('Установите приложение «Обла» в «Программы» перед обновлением.');
      await fs.promises.access(path.dirname(target), fs.constants.W_OK);
      // Verify the archive again immediately before extraction.
      const crypto = require('node:crypto');
      const hash = crypto.createHash('sha256'); let bytes = 0;
      for await (const chunk of fs.createReadStream(this.archive)) { bytes += chunk.length; hash.update(chunk); }
      if (bytes !== this.candidate.size || hash.digest('hex') !== this.candidate.sha256) throw new Error('Файл обновления изменился после загрузки. Скачайте его заново.');
      const { stdout } = await run('/usr/bin/unzip', ['-Z1', this.archive], { maxBuffer: 8 * 1024 * 1024 });
      for (const entry of stdout.split('\n').filter(Boolean)) {
        if (entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..') || !(entry === 'Maxweb.app/' || entry.startsWith('Maxweb.app/') || entry === '__MACOSX/' || entry.startsWith('__MACOSX/Maxweb.app/'))) throw new Error('Обновление содержит недопустимый путь.');
      }
      work = await fs.promises.mkdtemp(path.join(path.dirname(target), '.maxweb-update-'));
      await fs.promises.chmod(work, 0o700);
      await run('/usr/bin/ditto', ['-x', '-k', this.archive, work]);
      const staged = path.join(work, 'Maxweb.app');
      if ((await fs.promises.lstat(staged)).isSymbolicLink()) throw new Error('Недопустимая структура приложения в обновлении.');
      const plist = path.join(staged, 'Contents/Info.plist');
      const [{ stdout: identifier }, { stdout: version }, { stdout: architectures }] = await Promise.all([
        run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', plist]),
        run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', plist]),
        run('/usr/bin/lipo', ['-archs', path.join(staged, 'Contents/MacOS/Maxweb')])
      ]);
      if (identifier.trim() !== this.bundleId || version.trim() !== this.candidate.version || !matchesMacBinary(architectures, this.candidate.arch, this.arch)) throw new Error('Идентификатор, версия или архитектура приложения не совпадает с выпуском.');
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
      const helper = path.join(work, 'install-update.sh');
      await fs.promises.copyFile(path.join(__dirname, 'install-update.sh'), helper);
      await fs.promises.chmod(helper, 0o700);
      fs.mkdirSync(this.directory, { recursive: true });
      fs.writeFileSync(path.join(this.directory, 'pending.json'), JSON.stringify({ target, work, version: this.candidate.version }), { mode: 0o600 });
      await this.beforeInstall();
      const child = spawn('/bin/zsh', [helper, String(process.pid), target, staged, work, path.join(this.directory, 'install.log')], { detached: true, stdio: 'ignore' });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      this.quit();
      return this.snapshot();
    } catch (error) {
      if (work) await fs.promises.rm(work, { recursive: true, force: true });
      this.installing = false;
      this.archive = null;
      this.set({ status: 'available', progress: 0, message: `Не удалось установить обновление: ${error.message}` });
      throw error;
    }
  }
  async finishPending() {
    try {
      const file = path.join(this.directory, 'pending.json');
      const pending = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      const target = path.resolve(path.dirname(this.executable), '../..');
      if (pending.version === this.version && pending.target === target && path.dirname(pending.work) === path.dirname(target) && /^\.maxweb-update-[A-Za-z0-9]{6}$/.test(path.basename(pending.work))) {
        await fs.promises.rm(pending.work, { recursive: true, force: true });
        await fs.promises.rm(file, { force: true });
        this.set({ status: 'current', message: `Приложение «Обла» обновлено до версии ${this.version}. Все аккаунты сохранены.` });
      }
    } catch { /* There is no pending successful installation. */ }
  }
}
module.exports = { Updater };
