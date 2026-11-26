'use strict';
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Updater } = require('./updater.cjs');
const { verifyManifest } = require('./update-core.cjs');

function installerArguments(target) {
  if ((!path.isAbsolute(target) && !path.win32.isAbsolute(target)) || /["\x00-\x1f]/.test(target)) throw new Error('Недопустимый каталог установки.');
  // NSIS takes the entire remainder after /D=, without quotes, even with spaces.
  return ['--updated', '/S', '--force-run', `/D=${target}`];
}
class WindowsUpdater extends Updater {
  constructor(options) {
    super({ ...options, platform: 'win32' });
    this.spawnInstaller = options.spawnInstaller || spawn;
  }
  async install() {
    if (this.installing || this.busy) return this.snapshot();
    if (!this.packaged) throw new Error('Сначала установите приложение «Обла».');
    if (this.state.status !== 'ready' || !this.candidate || !this.archive) throw new Error('Сначала скачайте и проверьте обновление.');
    this.installing = true;
    this.set({ status: 'installing', message: 'Приложение перезапустится и установит обновление…' });
    const pending = path.join(this.directory, 'pending-windows.json');
    try {
      const candidate = verifyManifest(this.candidate, this.publicKey, this.candidate.downloadURL, { platform: 'win32', arch: this.arch, allowFile: this.candidate.downloadURL.startsWith('file:') });
      if (!(await fs.promises.lstat(this.archive)).isFile()) throw new Error('Некорректный файл обновления.');
      const hash = createHash('sha256'); let size = 0;
      for await (const chunk of fs.createReadStream(this.archive)) { size += chunk.length; hash.update(chunk); }
      if (size !== candidate.size || hash.digest('hex') !== candidate.sha256) throw new Error('Файл обновления изменился после загрузки. Скачайте его заново.');
      const file = await fs.promises.open(this.archive, 'r');
      try {
        const header = Buffer.alloc(64); await file.read(header, 0, 64, 0);
        const offset = header.readUInt32LE(0x3c);
        if (header.toString('ascii', 0, 2) !== 'MZ' || offset < 64 || offset > size - 6) throw new Error('Некорректный установщик Windows.');
        const pe = Buffer.alloc(6); await file.read(pe, 0, 6, offset);
        if (pe.readUInt32LE(0) !== 0x4550 || ![0x14c, 0x8664, 0xaa64].includes(pe.readUInt16LE(4))) throw new Error('Некорректный установщик Windows.');
      } finally { await file.close(); }
      const target = await fs.promises.realpath(path.dirname(this.executable));
      const args = installerArguments(target);
      await fs.promises.access(target, fs.constants.W_OK);
      await this.beforeInstall();
      fs.writeFileSync(pending, JSON.stringify({ version: candidate.version, target, filename: path.basename(this.archive) }), { mode: 0o600 });
      // Match NSIS's update protocol. The installer waits briefly for the app to
      // quit, keeps user data/shortcuts and relaunches the new version.
      const child = this.spawnInstaller(this.archive, args, {
        detached: true, stdio: 'ignore', windowsHide: true, shell: false,
        windowsVerbatimArguments: true, argv0: `"${this.archive}"`
      });
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
      child.unref(); this.quit(); return this.snapshot();
    } catch (error) {
      await fs.promises.rm(pending, { force: true }).catch(() => {});
      this.installing = false; this.archive = null;
      this.set({ status: 'available', progress: 0, message: `Не удалось установить обновление: ${error.message}` });
      throw error;
    }
  }
  async finishPending() {
    const file = path.join(this.directory, 'pending-windows.json');
    try {
      const pending = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (pending.version !== this.version || pending.filename !== `Obla-${this.version}-windows-${this.arch}.exe`) return;
      const installed = await fs.promises.realpath(path.dirname(this.executable));
      const target = await fs.promises.realpath(pending.target);
      if (installed.toLowerCase() !== target.toLowerCase()) return;
      await fs.promises.rm(path.join(this.directory, pending.filename), { force: true });
      await fs.promises.rm(file, { force: true });
      this.set({ status: 'current', message: `Приложение «Обла» обновлено до версии ${this.version}. Все аккаунты сохранены.` });
    } catch { /* No confirmed installation is pending. */ }
  }
}
module.exports = { WindowsUpdater, installerArguments };
