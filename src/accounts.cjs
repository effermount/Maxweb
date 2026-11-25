'use strict';
const { serviceInfo } = require('./services.cjs');
const { randomUUID } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validAccountId = id => id === 'default' || typeof id === 'string' && UUID.test(id);
function accountName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Введите название аккаунта — от 1 до 40 символов.');
  }
  return value.trim();
}
function accountAvatar(value) {
  return typeof value === 'string' && value.length <= 90000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
}
function normalizeAccounts(value) {
  const seen = new Set();
  const accounts = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || !validAccountId(item.id) || seen.has(item.id)) continue;
    try {
      serviceInfo(item.service);
      if (item.id === 'default' && item.service && item.service !== 'max') continue;
      const account = { id: item.id, name: accountName(item.name) };
      if (item.service) account.service = item.service;
      const avatar = accountAvatar(item.avatar);
      if (avatar) account.avatar = avatar;
      if (item.notifications === false) account.notifications = false;
      if (typeof item.customName === 'boolean') account.customName = item.customName;
      if (typeof item.profileName === 'string') { try { account.profileName = accountName(item.profileName); } catch {} }
      // Preserve names edited in earlier versions.
      if (item.customName === undefined && !item.profileName && item.name !== 'Основной') account.customName = true;
      accounts.push(account); seen.add(item.id);
    } catch {}
  }
  // Reuse the original v1.0 partition; never move or recreate its login data.
  if (!Array.isArray(value)) accounts.unshift({ id: 'default', name: 'Основной' });
  return accounts;
}
function accountPartition(id, service = 'max') {
  serviceInfo(service);
  if (service === 'telegram' && id === 'default') throw new Error('Неизвестный аккаунт.');
  if (!validAccountId(id)) throw new Error('Неизвестный аккаунт.');
  return id === 'default' ? 'persist:max' : `persist:${service}-${id}`;
}
function newAccount(name, service = 'max') {
  const info = serviceInfo(service);
  return { id: randomUUID(), service, name: accountName(name ?? `Новый аккаунт ${info.name}`), customName: false };
}
module.exports = { validAccountId, accountName, normalizeAccounts, accountPartition, newAccount, accountAvatar };
