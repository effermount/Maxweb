'use strict';
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const IDLE_SECONDS = [0, 60, 300, 900, 1800, 3600];
function validatePIN(pin) {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) throw new Error('Код должен содержать от 4 до 8 цифр.');
}
async function pinRecord(pin) {
  validatePIN(pin);
  const salt = randomBytes(32).toString('hex');
  return { salt, hash: (await derive(pin, salt, 64)).toString('hex') };
}
async function verifyPIN(pin, record) {
  validatePIN(pin);
  if (!record || !/^[a-f0-9]{64}$/.test(record.salt) || !/^[a-f0-9]{128}$/.test(record.hash)) return false;
  const actual = await derive(pin, record.salt, 64);
  return timingSafeEqual(actual, Buffer.from(record.hash, 'hex'));
}
function normalizeSecurity(value) {
  if (!value || typeof value !== 'object' || typeof value.verifier !== 'string' || !value.verifier) return { verifier: '', touchID: false, idleSeconds: 300, failures: 0, retryAt: 0 };
  return { verifier: value.verifier, touchID: value.touchID === true, idleSeconds: IDLE_SECONDS.includes(value.idleSeconds) ? value.idleSeconds : 300,
    failures: Number.isInteger(value.failures) ? Math.max(0, Math.min(20, value.failures)) : 0,
    retryAt: Number.isFinite(value.retryAt) ? Math.max(0, value.retryAt) : 0 };
}
class AppSecurity {
  constructor({ store, encrypt, decrypt, canTouchID, promptTouchID, onChange, now = Date.now }) {
    Object.assign(this, { store, encrypt, decrypt, canTouchID, promptTouchID, onChange, now });
    this.locked = !!store.get().security.verifier;
    this.lastActivity = now(); this.generation = 0; this.busy = false;
  }
  settings() { return this.store.get().security; }
  snapshot() {
    const s = this.settings();
    return { enabled: !!s.verifier, locked: this.locked, touchID: s.touchID, touchIDAvailable: this.canTouchID(), idleSeconds: s.idleSeconds, retryAt: s.retryAt };
  }
  activity() { if (!this.locked) this.lastActivity = this.now(); }
  lock() {
    if (!this.settings().verifier) return;
    this.locked = true; this.generation++; this.onChange();
  }
  checkIdle() {
    const seconds = this.settings().idleSeconds;
    if (!this.locked && seconds && this.now() - this.lastActivity >= seconds * 1000) this.lock();
  }
  requireUnlocked() { if (this.locked) throw new Error('Сначала разблокируйте приложение «Обла».'); }
  async exclusive(operation) {
    if (this.busy) throw new Error('Дождитесь завершения проверки.');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  async authenticate(pin) {
    const s = this.settings();
    if (this.now() < s.retryAt) throw new Error(`Повторите через ${Math.ceil((s.retryAt - this.now()) / 1000)} сек.`);
    let valid = false;
    try { valid = await verifyPIN(pin, JSON.parse(await this.decrypt(s.verifier))); } catch { /* Fail closed, including unavailable Keychain. */ }
    if (!valid) {
      const failures = Math.min(20, s.failures + 1);
      const retryAt = this.now() + (failures >= 5 ? Math.min(300, 30 * 2 ** (failures - 5)) * 1000 : 0);
      this.store.set({ security: { ...s, failures, retryAt } });
      throw new Error(retryAt > this.now() ? 'Слишком много попыток. Попробуйте позже.' : 'Неверный код или недоступна Связка ключей.');
    }
    this.store.set({ security: { ...s, failures: 0, retryAt: 0 } });
  }
  async configure({ currentPIN, pin, confirmPIN, touchID, idleSeconds, disable = false }) {
    this.requireUnlocked();
    return this.exclusive(async () => {
      const generation = this.generation;
      if (typeof disable !== 'boolean' || typeof touchID !== 'boolean' || !IDLE_SECONDS.includes(idleSeconds)) throw new Error('Неверные настройки блокировки.');
      if (this.settings().verifier) await this.authenticate(currentPIN);
      this.requireUnlocked();
      if (generation !== this.generation) throw new Error('Повторите настройку после разблокировки.');
      if (!disable && touchID && !this.canTouchID()) throw new Error('Touch ID недоступен на этом Mac.');
      if (!disable && !pin && confirmPIN) throw new Error('Коды не совпадают.');
      let verifier = this.settings().verifier;
      if (!disable && (pin || !verifier)) {
        validatePIN(pin);
        if (pin !== confirmPIN) throw new Error('Коды не совпадают.');
        verifier = await this.encrypt(JSON.stringify(await pinRecord(pin)));
      }
      this.requireUnlocked();
      if (generation !== this.generation) throw new Error('Повторите настройку после разблокировки.');
      this.store.set({ security: normalizeSecurity(disable ? null : { verifier, touchID, idleSeconds }) });
      this.activity(); this.onChange(); return this.snapshot();
    });
  }
  async unlock(pin, biometric = false) {
    return this.exclusive(async () => {
      if (!this.locked) return this.snapshot();
      const generation = this.generation;
      if (biometric) {
        if (!this.settings().touchID || !this.canTouchID()) throw new Error('Touch ID недоступен. Используйте код.');
        await this.promptTouchID();
      } else await this.authenticate(pin);
      if (generation !== this.generation) throw new Error('Состояние блокировки изменилось. Повторите попытку.');
      this.locked = false; this.activity(); this.onChange(); return this.snapshot();
    });
  }
}
module.exports = { AppSecurity, pinRecord, verifyPIN, normalizeSecurity, IDLE_SECONDS };
