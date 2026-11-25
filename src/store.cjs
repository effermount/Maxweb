'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { normalizeAccounts } = require('./accounts.cjs');
const { normalizeSecurity } = require('./security.cjs');
const { normalizeBanner } = require('./notifications.cjs');
const releaseConfig = require('./release-config.json');

function createStore(directory) {
  const file = path.join(directory, 'preferences.json');
  let data = {
    theme: 'system', maxZoom: 100, notifications: true, banner: normalizeBanner(), sidebarCollapsed: false, security: normalizeSecurity(), window: { width: 1180, height: 820 },
    accounts: normalizeAccounts(), activeAccountId: 'default',
    updates: { repository: releaseConfig.repository, autoCheck: true, userConfigured: false }
  };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof saved.notifications === 'boolean') data.notifications = saved.notifications;
    if (['system', 'light', 'dark'].includes(saved.theme)) data.theme = saved.theme;
    if (Number.isInteger(saved.maxZoom) && saved.maxZoom >= 50 && saved.maxZoom <= 200) data.maxZoom = saved.maxZoom;
    data.banner = normalizeBanner(saved.banner);
    data.security = normalizeSecurity(saved.security);
    data.sidebarCollapsed = saved.sidebarCollapsed === true;
    data.accounts = normalizeAccounts(saved.accounts);
    data.activeAccountId = data.accounts[0]?.id || null;
    if (data.accounts.some(a => a.id === saved.activeAccountId)) data.activeAccountId = saved.activeAccountId;
    if (saved.updates && typeof saved.updates === 'object') {
      if (typeof saved.updates.repository === 'string' && (saved.updates.repository.trim() || saved.updates.userConfigured === true)) data.updates.repository = saved.updates.repository;
      if (typeof saved.updates.autoCheck === 'boolean') data.updates.autoCheck = saved.updates.autoCheck;
      if (saved.updates.userConfigured === true) data.updates.userConfigured = true;
      if (releaseConfig.previousRepositories.some(repository => repository.toLowerCase() === data.updates.repository.trim().toLowerCase())) data.updates.repository = releaseConfig.repository;
    }
    if (saved.window && Number.isFinite(saved.window.width) && Number.isFinite(saved.window.height)) {
      data.window = { width: Math.max(800, Math.min(3840, saved.window.width)), height: Math.max(600, Math.min(2160, saved.window.height)) };
      if (Number.isFinite(saved.window.x) && Number.isFinite(saved.window.y)) {
        data.window.x = saved.window.x;
        data.window.y = saved.window.y;
      }
    }
  } catch { /* First launch or invalid preferences: use defaults. */ }
  return {
    get: () => structuredClone(data),
    set(patch) {
      const updated = { ...data, ...patch };
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(updated, null, 2), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      data = updated;
      return this.get();
    }
  };
}
module.exports = { createStore };
