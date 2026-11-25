'use strict';
const { app, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, session, shell, ipcMain, Notification, dialog, systemPreferences, powerMonitor, screen, safeStorage, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isServiceURL, isExternalURL, mayUsePermission, unreadBadge } = require('./policy.cjs');
const { serviceInfo } = require('./services.cjs');
const { createStore } = require('./store.cjs');
const { newAccount, accountName, accountPartition, accountAvatar } = require('./accounts.cjs');
const { normalizeRepository } = require('./update-core.cjs');
const { AppSecurity } = require('./security.cjs');
const { normalizeBanner, bannerContent } = require('./notifications.cjs');
const { Updater } = require('./updater.cjs');
const APP_VERSION = require('../package.json').version;
const SIDEBAR = 220;
const uiURL = name => pathToFileURL(path.join(__dirname, `ui/${name}.html`)).href;
const shellURL = uiURL('shell');
const settingsURL = uiURL('settings');
const offlineURL = uiURL('offline');
const telegramOfflineURL = uiURL('offline-telegram');
const whatsappOfflineURL = uiURL('offline-whatsapp');
const offlineFor = service => service === 'whatsapp' ? whatsappOfflineURL : service === 'telegram' ? telegramOfflineURL : offlineURL;
const isOfflineURL = url => [offlineURL, telegramOfflineURL, whatsappOfflineURL].includes(url);

app.setName('Maxweb');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('lang', 'ru');

let mainWindow, settingsView, tray, store, updater, security;
let quitting = false, switching = false, activePane = 'account';
let autoCheckTimer, initialCheckTimer, cleanupTimer, idleTimer;
const runtimes = new Map();
const activeNotifications = new Set();
const accountNotifications = new Map();
const sidebarWidth = () => preferences().sidebarCollapsed ? 72 : SIDEBAR;
const preferences = () => store.get();
const activeId = () => preferences().activeAccountId;
const activeRuntime = () => runtimes.get(activeId());
const accountInfo = id => serviceInfo(preferences().accounts.find(a => a.id === id)?.service);
const accountURL = (url, id) => { const account = preferences().accounts.find(a => a.id === id); return !!account && isServiceURL(url, account.service); };
const accountTitle = account => `${account.name} — ${serviceInfo(account.service).name}`;

const MAX_ZOOM_LEVELS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
function setMaxZoom(percent) {
  security.requireUnlocked();
  if (!Number.isInteger(percent) || percent < 50 || percent > 200) throw new Error('Введите целый масштаб от 50 до 200%.');
  if (preferences().maxZoom !== percent) store.set({ maxZoom: percent });
  for (const [id, { view }] of runtimes) {
    const contents = view.webContents;
    if (!contents.isDestroyed() && accountURL(contents.getURL(), id)) contents.setZoomFactor(percent / 100);
  }
  if (settingsView && !settingsView.webContents.isDestroyed()) settingsView.webContents.send('max-zoom:state', percent);
  return percent;
}
function stepMaxZoom(direction) {
  if (security.locked) return;
  const current = preferences().maxZoom;
  const next = direction === 'in' ? MAX_ZOOM_LEVELS.find(value => value > current) : MAX_ZOOM_LEVELS.findLast(value => value < current);
  setMaxZoom(next ?? current);
}
const themeState = () => ({ source: preferences().theme, dark: nativeTheme.shouldUseDarkColors });
const themeBackground = pane => nativeTheme.shouldUseDarkColors ? (pane === 'settings' ? '#1b1b23' : '#20202a') : (pane === 'settings' ? '#f6f5fa' : '#f1eff7');
function themeChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(themeBackground('shell'));
  if (settingsView && !settingsView.webContents.isDestroyed()) {
    settingsView.setBackgroundColor(themeBackground('settings'));
    settingsView.webContents.send('theme:state', themeState());
  }
}
let pendingNotificationClick;
function clearAccountNotifications(id) {
  if (pendingNotificationClick?.id === id) pendingNotificationClick = null;
  for (const [key, notification] of accountNotifications) if (key.startsWith(`${id}:`)) { notification.close(); accountNotifications.delete(key); }
}
function clearNotifications() {
  for (const notification of accountNotifications.values()) notification.close();
  accountNotifications.clear();
  for (const notification of activeNotifications) notification.close();
  activeNotifications.clear();
}
function securityChanged() {
  if (security.locked) {
    clearNotifications();
    if (settingsView && !settingsView.webContents.isDestroyed()) settingsView.webContents.send('security:locked');
    mainWindow?.setTitle('Maxweb — заблокировано');
    mainWindow?.webContents.focus();
  }
  layout(); broadcast();
  if (!security.locked) {
    if (pendingNotificationClick) {
      const pending = pendingNotificationClick; pendingNotificationClick = null;
      selectAccount(pending.id);
      if (!pending.sender.isDestroyed()) {
        pending.sender.send('account:notification-event', { id: pending.notificationID, type: 'click' });
        pending.sender.send('account:notification-event', { id: pending.notificationID, type: 'close' });
      }
    } else if (activePane === 'account' && activeId()) selectAccount(activeId(), false);
  }
}
function shellState() {
  const state = preferences();
  if (security?.locked) return { locked: true, security: security.snapshot(), version: APP_VERSION };
  return {
    locked: false, security: security?.snapshot(), sidebarCollapsed: state.sidebarCollapsed,
    accounts: state.accounts.map(account => ({ ...account, active: account.id === state.activeAccountId && activePane === 'account', unread: runtimes.get(account.id)?.unread || '', status: runtimes.get(account.id)?.status || 'loading' })),
    pane: activePane, activeAccountId: state.activeAccountId,
    version: APP_VERSION, update: updater?.snapshot() || { status: 'idle' }
  };
}
function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) mainWindow.webContents.send('shell:state', shellState());
  if (settingsView && !settingsView.webContents.isDestroyed() && !settingsView.webContents.isLoading()) settingsView.webContents.send('updates:state', updater.snapshot());
  let total = 0;
  for (const runtime of runtimes.values()) total += runtime.unread === '99+' ? 100 : Number(runtime.unread || 0);
  app.dock?.setBadge(security?.locked ? '' : total > 99 ? '99+' : total ? String(total) : '');
}
function layout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const sidebar = sidebarWidth();
  const bounds = { x: sidebar, y: 0, width: Math.max(1, width - sidebar), height };
  for (const [id, runtime] of runtimes) {
    runtime.view.setBounds(bounds);
    runtime.view.setVisible(!security.locked && activePane === 'account' && id === activeId());
  }
  if (settingsView) { settingsView.setBounds(bounds); settingsView.setVisible(!security.locked && activePane === 'settings'); }
}
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); app.focus({ steal: true }); mainWindow.focus();
}
function selectAccount(id, focus = true) {
  if (security.locked) { showWindow(); return shellState(); }
  if (!preferences().accounts.some(account => account.id === id)) throw new Error('Аккаунт не найден.');
  if (loggingOut.has(id)) return shellState();
  switching = true;
  try {
    if (activeId() !== id) store.set({ activeAccountId: id });
    activePane = 'account';
    const runtime = runtimes.get(id) || createAccountView(preferences().accounts.find(a => a.id === id));
    layout();
    mainWindow.setTitle(accountTitle(preferences().accounts.find(a => a.id === id)));
    if (focus) { showWindow(); runtime.view.webContents.focus(); }
    broadcast();
  } finally { switching = false; }
  return shellState();
}
function addAccount(name, service = 'max') {
  security.requireUnlocked();
  const account = newAccount(name, service);
  store.set({ accounts: [...preferences().accounts, account] });
  createAccountView(account);
  selectAccount(account.id);
  return shellState();
}
const loggingOut = new Set();
async function logoutAccount(id) {
  security.requireUnlocked();
  const account = preferences().accounts.find(a => a.id === id);
  if (!account) throw new Error('Аккаунт не найден.');
  if (loggingOut.has(id)) return shellState();
  loggingOut.add(id);
  try {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', message: `Выйти из «${account.name}»?`,
      detail: `Сессия ${serviceInfo(account.service).name} на этом Mac будет удалена, а аккаунт исчезнет из боковой панели. Для повторного входа потребуется авторизация. Другие аккаунты останутся на месте.`,
      buttons: ['Отмена', 'Выйти'], defaultId: 0, cancelId: 0, noLink: true
    });
    security.requireUnlocked();
    if (response !== 1) return shellState();
    const runtime = runtimes.get(id);
    const ses = runtime?.session || session.fromPartition(accountPartition(id, account.service));
    clearAccountNotifications(id);
    if (runtime) {
      clearTimeout(runtime.retryTimer);
      runtimes.delete(id);
      mainWindow.contentView.removeChildView(runtime.view);
      if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close({ waitForBeforeUnload: false });
    }
    try {
      await ses.closeAllConnections();
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
      await ses.cookies.flushStore();
    } catch (error) {
      if (preferences().accounts.some(a => a.id === id)) createAccountView(account);
      layout(); broadcast();
      throw new Error('Не удалось полностью очистить сессию. Повторите выход.', { cause: error });
    }
    const accounts = preferences().accounts.filter(a => a.id !== id);
    const next = activeId() === id ? accounts[0]?.id || null : activeId();
    store.set({ accounts, activeAccountId: next });
    if (activePane === 'account' && next && !security.locked) selectAccount(next, false);
    else { layout(); broadcast(); }
    if (!accounts.length && !security.locked) { mainWindow.setTitle('Maxweb'); mainWindow.webContents.focus(); }
    return shellState();
  } finally { loggingOut.delete(id); }
}
function renameAccount(id, name) {
  security.requireUnlocked();
  if (!preferences().accounts.some(a => a.id === id)) throw new Error('Аккаунт не найден.');
  store.set({ accounts: preferences().accounts.map(a => a.id === id ? { ...a, name: accountName(name), customName: true } : a) });
  if (id === activeId() && activePane === 'account') mainWindow.setTitle(`${accountName(name)} — ${accountInfo(id).name}`);
  broadcast(); return shellState();
}
function external(url) { if (isExternalURL(url)) void shell.openExternal(url).catch(() => {}); }
function secureNavigation(contents, id) {
  contents.setWindowOpenHandler(({ url }) => {
    if (accountURL(url, id)) { if (!security.locked) { selectAccount(id); void contents.loadURL(url).catch(() => {}); } }
    else external(url);
    return { action: 'deny' };
  });
  const guard = event => { if (!accountURL(event.url, id)) { event.preventDefault(); external(event.url); } };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', event => event.preventDefault());
}
function configureSession(ses, service = 'max') {
  const userAgent = service === 'whatsapp' ? ses.getUserAgent().replace(/\s(?:Electron|Maxweb)\/[\w.-]+/g, '') : ses.getUserAgent();
  ses.setUserAgent(userAgent, 'ru-RU,ru,en-US,en');
  const topURL = contents => contents && !contents.isDestroyed() ? contents.getURL() : '';
  ses.setPermissionCheckHandler((contents, permission, origin) => mayUsePermission(permission, origin, topURL(contents), preferences().notifications, service));
  ses.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    if (!mayUsePermission(permission, details.requestingUrl, topURL(contents), preferences().notifications, service)) return callback(false);
    if (permission === 'media') {
      try {
        for (const type of details.mediaTypes || []) {
          if (!['audio', 'video'].includes(type)) return callback(false);
          if (!await systemPreferences.askForMediaAccess(type === 'audio' ? 'microphone' : 'camera')) return callback(false);
        }
      } catch { return callback(false); }
    }
    callback(true);
  });
  ses.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: `Сохранить файл из ${serviceInfo(service).name}`, buttonLabel: 'Сохранить' });
    item.once('done', (_event, state) => {
      if (state === 'interrupted') void dialog.showMessageBox({ type: 'warning', message: 'Не удалось скачать файл', detail: 'Проверьте соединение и попробуйте ещё раз.' });
    });
  });
}
async function loadMax(id = activeId()) {
  const runtime = runtimes.get(id);
  if (!runtime || runtime.view.webContents.isDestroyed()) return;
  clearTimeout(runtime.retryTimer);
  runtime.status = 'loading'; broadcast();
  await runtime.view.webContents.loadURL(accountInfo(id).url).catch(() => {});
}
function createAccountView(account) {
  const id = account.id;
  const ses = session.fromPartition(accountPartition(account.id, account.service));
  configureSession(ses, account.service);
  const view = new WebContentsView({ webPreferences: {
    preload: path.join(__dirname, 'account-preload.cjs'),
    session: ses, zoomFactor: preferences().maxZoom / 100, zoomMode: 'isolated', nodeIntegration: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false, spellcheck: true
  } });
  view.setBackgroundColor('#17181c');
  view.setVisible(false);
  mainWindow.contentView.addChildView(view);
  const runtime = { view, session: ses, unread: '', status: 'loading', retryTimer: null };
  runtimes.set(account.id, runtime);
  const contents = view.webContents;
  contents.on('before-input-event', () => security.activity());
  contents.on('zoom-changed', (_event, direction) => {
    setImmediate(() => { if (!contents.isDestroyed() && accountURL(contents.getURL(), id)) stepMaxZoom(direction); });
  });
  secureNavigation(contents, account.id);
  contents.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) clearAccountNotifications(account.id); });
  contents.on('page-title-updated', (_event, title) => { runtime.unread = unreadBadge(title); broadcast(); });
  contents.on('did-finish-load', () => {
    contents.setZoomFactor(accountURL(contents.getURL(), id) ? preferences().maxZoom / 100 : 1);
    runtime.status = isOfflineURL(contents.getURL()) ? 'offline' : 'ready'; broadcast();
  });
  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !accountURL(url, account.id) || quitting) return;
    clearTimeout(runtime.retryTimer);
    void contents.loadURL(offlineFor(account.service)).then(() => {
      runtime.status = 'offline'; broadcast();
      runtime.retryTimer = setTimeout(() => loadMax(account.id), 15000);
    }).catch(() => {});
  });
  contents.on('render-process-gone', () => {
    clearAccountNotifications(account.id);
    if (!quitting) { clearTimeout(runtime.retryTimer); runtime.retryTimer = setTimeout(() => loadMax(account.id), 1500); }
  });
  void loadMax(account.id);
  layout();
  return runtime;
}
function localPreferences(preload) {
  return { preload: path.join(__dirname, preload), zoomMode: 'disabled', zoomFactor: 1, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };
}
function showSettings() {
  if (security.locked) { showWindow(); return; }
  if (!settingsView) {
    settingsView = new WebContentsView({ webPreferences: localPreferences('settings-preload.cjs') });
    settingsView.setBackgroundColor(themeBackground('settings'));
    mainWindow.contentView.addChildView(settingsView);
    settingsView.webContents.on('before-input-event', () => security.activity());
    settingsView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    settingsView.webContents.on('will-navigate', event => event.preventDefault());
    void settingsView.webContents.loadURL(settingsURL);
  }
  activePane = 'settings'; layout(); mainWindow.setTitle('Настройки Maxweb'); showWindow(); broadcast();
  return settingsView;
}
function createMainWindow() {
  const saved = preferences().window;
  const visible = screen.getAllDisplays().some(({ workArea: a }) => saved.x !== undefined && saved.y !== undefined && saved.x + 100 > a.x && saved.x < a.x + a.width - 100 && saved.y + 100 > a.y && saved.y < a.y + a.height - 100);
  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    title: 'Maxweb', width: Math.min(saved.width, area.width), height: Math.min(saved.height, area.height),
    ...(visible ? { x: saved.x, y: saved.y } : {}), minWidth: 1000, minHeight: 650,
    backgroundColor: themeBackground('shell'), show: false, webPreferences: localPreferences('shell-preload.cjs')
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('did-finish-load', broadcast);
  mainWindow.webContents.on('before-input-event', () => security.activity());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
  let boundsTimer;
  const saveBounds = () => {
    layout(); clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed() && !mainWindow.isFullScreen() && !mainWindow.isMaximized()) {
        try { store.set({ window: mainWindow.getBounds() }); } catch (error) { console.error('Window preferences:', error.message); }
      }
    }, 400);
  };
  mainWindow.on('resize', saveBounds); mainWindow.on('move', saveBounds);
  mainWindow.on('closed', () => {
    clearTimeout(boundsTimer);
    for (const runtime of runtimes.values()) { clearTimeout(runtime.retryTimer); if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close(); }
    if (settingsView && !settingsView.webContents.isDestroyed()) settingsView.webContents.close();
    runtimes.clear(); mainWindow = null;
  });
  void mainWindow.loadURL(shellURL);
  for (const account of preferences().accounts) createAccountView(account);
  if (activeId()) selectAccount(activeId(), false);
}
function testNotification() {
  return new Promise((resolve, reject) => {
    if (!preferences().notifications) return reject(new Error('Сначала включите уведомления в настройках Maxweb.'));
    if (!Notification.isSupported()) return reject(new Error('Уведомления недоступны в этой системе.'));
    const account = preferences().accounts.find(a => a.id === activeId()) || { name: 'Аккаунт MAX' };
    const notification = new Notification({ ...bannerContent(account, 'Отправитель MAX', 'Так будет выглядеть текст нового сообщения.', preferences().banner, security.locked) });
    activeNotifications.add(notification);
    let settled = false;
    const timeout = setTimeout(() => { if (!settled) { settled = true; resolve({ delivered: false }); } }, 5000);
    notification.on('show', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve({ delivered: true }); } });
    notification.on('failed', (_event, message) => {
      activeNotifications.delete(notification);
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(message || 'macOS не разрешила уведомление.')); }
    });
    notification.on('click', () => { if (preferences().accounts.some(a => a.id === account.id)) selectAccount(account.id); else showSettings(); });
    notification.on('close', () => activeNotifications.delete(notification));
    notification.show();
  });
}
function trusted(contents, url, event) {
  return contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame && event.senderFrame.url === url;
}
function bindIPC() {
  const senderAccount = event => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return;
    for (const [id, runtime] of runtimes) if (runtime.view.webContents === event.sender && accountURL(event.senderFrame.url, id)) return id;
  };
  ipcMain.on('app:activity', event => {
    if (senderAccount(event) || trusted(mainWindow?.webContents, shellURL, event) || trusted(settingsView?.webContents, settingsURL, event)) security.activity();
  });
  ipcMain.on('account:profile', (event, profile) => {
    const id = senderAccount(event);
    if (!id || !profile || typeof profile !== 'object') return;
    let name;
    try { name = accountName(profile.name); } catch { return; }
    const avatar = accountAvatar(profile.avatar);
    const account = preferences().accounts.find(a => a.id === id);
    if (!account || account.profileName === name && (account.avatar || '') === avatar) return;
    store.set({ accounts: preferences().accounts.map(a => a.id === id ? { ...a, profileName: name, avatar, ...(!a.customName ? { name } : {}) } : a) });
    if (id === activeId() && !security.locked && activePane === 'account') mainWindow.setTitle(accountTitle(preferences().accounts.find(a => a.id === id)));
    broadcast();
  });
  ipcMain.on('account:notification', (event, request) => {
    const id = senderAccount(event);
    if (!id || !request || typeof request.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(request.id)) return;
    const key = `${id}:${request.id}`;
    if (request.type === 'close') { accountNotifications.get(key)?.close(); accountNotifications.delete(key); return; }
    if (request.type !== 'show' || accountNotifications.has(key)) return;
    const reply = type => { if (!event.sender.isDestroyed()) event.sender.send('account:notification-event', { id: request.id, type }); };
    if (!preferences().notifications || !Notification.isSupported() || accountNotifications.size >= 100) { reply('error'); return; }
    const account = preferences().accounts.find(a => a.id === id);
    if (account.notifications === false) { reply('close'); return; }
    if (typeof request.title !== 'string' || typeof request.body !== 'string') return;
    const notification = new Notification(bannerContent(account, request.title, request.body, preferences().banner, security.locked));
    accountNotifications.set(key, notification);
    notification.on('show', () => reply('show'));
    notification.on('click', () => {
      if (security.locked) {
        // Delay MAX's click handler until authenticated, so links never bypass the lock.
        pendingNotificationClick = { id, sender: event.sender, notificationID: request.id };
        showWindow();
      } else { selectAccount(id); reply('click'); }
      notification.close();
    });
    notification.on('close', () => { accountNotifications.delete(key); if (pendingNotificationClick?.notificationID !== request.id || pendingNotificationClick?.id !== id) reply('close'); });
    notification.on('failed', () => { accountNotifications.delete(key); reply('error'); });
    notification.show();
  });
  const handle = (channel, audience, handler) => ipcMain.handle(channel, async (event, ...args) => {
    const allowed = audience === 'shell'
      ? trusted(mainWindow?.webContents, shellURL, event)
      : trusted(settingsView?.webContents, settingsURL, event);
    if (!allowed) throw new Error('Недоверенный источник запроса.');
    if (!['shell:get', 'security:unlock', 'security:touch-id', 'security:lock'].includes(channel)) security.requireUnlocked();
    return handler(...args);
  });
  handle('shell:get', 'shell', shellState);
  handle('shell:collapse', 'shell', collapsed => {
    if (typeof collapsed !== 'boolean') throw new Error('Неверное значение.');
    store.set({ sidebarCollapsed: collapsed }); layout(); broadcast(); return shellState();
  });
  handle('security:lock', 'shell', () => { security.lock(); return shellState(); });
  handle('security:unlock', 'shell', pin => security.unlock(pin));
  handle('security:touch-id', 'shell', () => security.unlock(undefined, true));
  handle('accounts:profile-name', 'shell', id => {
    const account = preferences().accounts.find(a => a.id === id);
    if (!account) throw new Error('Аккаунт не найден.');
    store.set({ accounts: preferences().accounts.map(a => a.id === id ? { ...a, customName: false, name: a.profileName || a.name } : a) });
    broadcast(); return shellState();
  });
  handle('accounts:select', 'shell', selectAccount);
  handle('accounts:add', 'shell', addAccount);
  handle('accounts:logout', 'shell', logoutAccount);
  handle('accounts:rename', 'shell', renameAccount);
  handle('accounts:notifications', 'shell', (id, enabled) => {
    if (typeof enabled !== 'boolean' || !preferences().accounts.some(a => a.id === id)) throw new Error('Неверные настройки аккаунта.');
    store.set({ accounts: preferences().accounts.map(a => a.id === id ? { ...a, notifications: enabled } : a) });
    if (!enabled) clearAccountNotifications(id);
    broadcast(); return shellState();
  });
  handle('shell:settings', 'shell', () => { showSettings(); });
  handle('settings:get', 'settings', () => ({ theme: themeState(), maxZoom: preferences().maxZoom, notifications: preferences().notifications, banner: preferences().banner, security: security.snapshot(), openAtLogin: app.getLoginItemSettings().openAtLogin, packaged: app.isPackaged, version: APP_VERSION, arch: process.arch, updates: preferences().updates, update: updater.snapshot() }));
  handle('settings:max-zoom', 'settings', setMaxZoom);
  handle('settings:theme', 'settings', source => {
    if (!['system', 'light', 'dark'].includes(source)) throw new Error('Выберите системную, светлую или тёмную тему.');
    store.set({ theme: source });
    nativeTheme.themeSource = source; themeChanged();
    return themeState();
  });
  handle('settings:notifications', 'settings', enabled => {
    if (typeof enabled !== 'boolean') throw new Error('Неверное значение.');
    store.set({ notifications: enabled });
    if (!enabled) clearNotifications();
    for (const [id, { view }] of runtimes) if (accountURL(view.webContents.getURL(), id)) view.webContents.reload();
    return enabled;
  });
  handle('settings:banner', 'settings', value => {
    if (!value || Object.keys(normalizeBanner()).some(key => typeof value[key] !== 'boolean')) throw new Error('Неверные настройки баннера.');
    store.set({ banner: normalizeBanner(value) }); clearNotifications(); return preferences().banner;
  });
  handle('settings:security', 'settings', value => security.configure(value || {}));
  handle('settings:lock', 'settings', () => security.lock());
  handle('settings:login', 'settings', enabled => {
    if (!app.isPackaged || typeof enabled !== 'boolean') throw new Error('Автозапуск доступен в установленном приложении.');
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false });
    return app.getLoginItemSettings().openAtLogin;
  });
  handle('settings:test', 'settings', testNotification);
  handle('settings:system', 'settings', () => shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension'));
  handle('settings:open', 'settings', () => {
    if (activeId()) return selectAccount(activeId());
    activePane = 'account'; layout(); broadcast(); mainWindow.setTitle('Maxweb'); mainWindow.webContents.focus();
  });
  handle('updates:configure', 'settings', (repository, autoCheck) => {
    if (typeof autoCheck !== 'boolean' || typeof repository !== 'string') throw new Error('Неверные настройки обновлений.');
    if (updater.busy || updater.installing) throw new Error('Дождитесь завершения обновления.');
    const updates = { repository: repository.trim() ? normalizeRepository(repository) : '', autoCheck, userConfigured: true };
    store.set({ updates }); updater.reset(); broadcast(); return updates;
  });
  handle('updates:check', 'settings', () => updater.check());
  handle('updates:download', 'settings', () => updater.download());
  handle('updates:install', 'settings', () => updater.install());
}
async function checkUpdates() {
  showSettings();
  try { await updater.check(); } catch { /* Error is displayed inside settings. */ }
}
function createMenu() {
  const notificationTest = () => testNotification().catch(error => dialog.showMessageBox({ type: 'warning', message: 'Не удалось показать уведомление', detail: error.message }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Maxweb', submenu: [
      { label: 'О Maxweb', click: () => dialog.showMessageBox({ type: 'info', message: `Maxweb ${APP_VERSION}`, detail: 'Независимый клиент MAX, Telegram и WhatsApp для Apple Silicon.\nАккаунты сохраняют отдельные авторизации и работают в фоне.\nПолный выход — ⌘Q.' }) },
      { label: 'Проверить обновления…', click: checkUpdates },
      { label: 'Заблокировать Maxweb', accelerator: 'CmdOrCtrl+L', click: () => security.lock() },
      { label: 'Настройки…', accelerator: 'CmdOrCtrl+,', click: showSettings },
      { type: 'separator' }, { role: 'services', label: 'Службы' },
      { type: 'separator' }, { role: 'hide', label: 'Скрыть Maxweb' }, { role: 'hideOthers', label: 'Скрыть остальные' }, { role: 'unhide', label: 'Показать все' },
      { type: 'separator' }, { role: 'quit', label: 'Завершить Maxweb' }
    ] },
    { label: 'Правка', submenu: [{ role: 'undo', label: 'Отменить' }, { role: 'redo', label: 'Повторить' }, { type: 'separator' }, { role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' }, { role: 'selectAll', label: 'Выбрать всё' }] },
    { label: 'Аккаунты', submenu: [
      ...Array.from({ length: 9 }, (_, index) => ({ label: `Аккаунт ${index + 1}`, accelerator: `CmdOrCtrl+${index + 1}`, click: () => { const a = preferences().accounts[index]; if (a) selectAccount(a.id); } })),
      { type: 'separator' },
      { label: 'Следующий аккаунт', accelerator: 'Ctrl+Tab', click: () => cycleAccount(1) },
      { label: 'Предыдущий аккаунт', accelerator: 'Ctrl+Shift+Tab', click: () => cycleAccount(-1) }
    ] },
    { label: 'Вид', submenu: [
      { label: 'Свернуть / развернуть панель', accelerator: 'CmdOrCtrl+Shift+S', click: () => { if (security.locked) return; store.set({ sidebarCollapsed: !preferences().sidebarCollapsed }); layout(); broadcast(); } },
      { label: 'Перезагрузить мессенджер', accelerator: 'CmdOrCtrl+R', click: () => loadMax() },
      { type: 'separator' },
      { label: 'Масштаб содержимого 100%', accelerator: 'CmdOrCtrl+0', click: () => { if (!security.locked) setMaxZoom(100); } },
      { label: 'Увеличить содержимое', accelerator: 'CmdOrCtrl+Plus', click: () => stepMaxZoom('in') },
      { label: 'Уменьшить содержимое', accelerator: 'CmdOrCtrl+-', click: () => stepMaxZoom('out') },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'На весь экран' }
    ] },
    { label: 'Окно', submenu: [{ role: 'minimize', label: 'Свернуть' }, { role: 'zoom', label: 'Масштабировать' }, { role: 'close', label: 'Закрыть окно' }] },
    { label: 'Помощь', submenu: [{ label: 'Проверить уведомления', click: notificationTest }, { label: 'Справка MAX', click: () => external('https://help.max.ru/') }] }
  ]));
  const image = nativeImage.createFromPath(path.join(__dirname, '../assets/trayTemplate.png')); image.setTemplateImage(true);
  tray = new Tray(image); tray.setToolTip('Maxweb — все аккаунты работают в фоне');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Maxweb', click: showWindow }, { label: 'Настройки и обновления…', click: showSettings },
    { type: 'separator' }, { label: 'Завершить Maxweb', click: () => app.quit() }
  ]));
  tray.on('click', showWindow);
}
function cycleAccount(direction) {
  const accounts = preferences().accounts;
  if (!accounts.length) return;
  const index = accounts.findIndex(a => a.id === activeId());
  selectAccount(accounts[(index + direction + accounts.length) % accounts.length].id);
}
async function flushSessions() {
  await Promise.all([...runtimes.values()].map(async ({ session: ses }) => { ses.flushStorageData(); await ses.cookies.flushStore(); }));
}
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
app.on('second-instance', showWindow);
app.on('activate', () => { if (app.isReady() && mainWindow) showWindow(); });
app.on('before-quit', () => {
  quitting = true; clearTimeout(initialCheckTimer); clearTimeout(cleanupTimer); clearInterval(autoCheckTimer); clearInterval(idleTimer);
  for (const runtime of runtimes.values()) clearTimeout(runtime.retryTimer);
});
app.on('window-all-closed', () => {});
const ready = hasLock ? app.whenReady().then(async () => {
  store = createStore(app.getPath('userData'));
  nativeTheme.themeSource = preferences().theme;
  nativeTheme.on('updated', themeChanged);
  security = new AppSecurity({
    store,
    encrypt: async value => {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Связка ключей macOS недоступна. Повторите позже.');
      return (await safeStorage.encryptStringAsync(value)).toString('base64');
    },
    decrypt: async value => (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result,
    canTouchID: () => process.platform === 'darwin' && systemPreferences.canPromptTouchID(),
    promptTouchID: () => systemPreferences.promptTouchID('разблокировать Maxweb'),
    onChange: securityChanged
  });
  // Node's HTTP stack has no Chromium cookie jar. Its Fetch implementation also
  // exposes manual redirects; Electron's net.fetch cancels them instead.
  let notifiedVersion;
  updater = new Updater({
    version: APP_VERSION, directory: path.join(app.getPath('userData'), 'Updates'),
    publicKey: fs.readFileSync(path.join(__dirname, '../assets/release-public.pem')),
    getSettings: () => preferences().updates, packaged: app.isPackaged,
    fetchImpl: (url, options) => globalThis.fetch(url, options),
    beforeInstall: flushSessions, quit: () => app.quit(),
    onChange: state => {
      broadcast();
      if (state.status === 'available' && state.version !== notifiedVersion && app.isPackaged) {
        notifiedVersion = state.version;
        const notification = new Notification({ title: 'Обновление Maxweb', body: `Доступна версия ${state.version}. Нажмите, чтобы скачать.` });
        activeNotifications.add(notification);
        notification.on('click', showSettings);
        notification.on('close', () => activeNotifications.delete(notification));
        notification.on('failed', () => activeNotifications.delete(notification));
        notification.show();
      }
    }
  });
  bindIPC(); createMenu(); createMainWindow();
  idleTimer = setInterval(() => security.checkIdle(), 1000);
  powerMonitor.on('suspend', () => security.lock());
  powerMonitor.on('lock-screen', () => security.lock());
  const autoCheck = () => { if (preferences().updates.autoCheck && preferences().updates.repository) void updater.check().catch(() => {}); };
  if (app.isPackaged) {
    initialCheckTimer = setTimeout(autoCheck, 15000);
    autoCheckTimer = setInterval(autoCheck, 6 * 60 * 60 * 1000);
    cleanupTimer = setTimeout(() => updater.finishPending(), 15000);
  }
  powerMonitor.on('resume', () => {
    for (const [id, runtime] of runtimes) if (isOfflineURL(runtime.view.webContents.getURL())) void loadMax(id);
    autoCheck();
  });
}) : Promise.resolve();
ready.catch(error => { dialog.showErrorBox('Не удалось запустить Maxweb', error.message); app.quit(); });
module.exports = {
  ready, showWindow, showSettings, loadMax, testNotification, addAccount, renameAccount, selectAccount, flushSessions,
  getMainWindow: () => mainWindow, getSession: (id = activeId()) => runtimes.get(id)?.session,
  getAccountContents: (id = activeId()) => runtimes.get(id)?.view.webContents,
  getAccountNotifications: () => accountNotifications,
  getState: shellState, getSecurity: () => security, getUpdater: () => updater
};
