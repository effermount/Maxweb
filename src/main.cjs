'use strict';
const { app, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, session, shell, ipcMain, Notification, dialog, systemPreferences, powerMonitor, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { MAX_URL, isMaxURL, isExternalURL, mayUsePermission, unreadBadge } = require('./policy.cjs');
const { createStore } = require('./store.cjs');
const { newAccount, accountName, accountPartition } = require('./accounts.cjs');
const { normalizeRepository } = require('./update-core.cjs');
const { Updater } = require('./updater.cjs');
const APP_VERSION = require('../package.json').version;
const SIDEBAR = 220;
const uiURL = name => pathToFileURL(path.join(__dirname, `ui/${name}.html`)).href;
const shellURL = uiURL('shell');
const settingsURL = uiURL('settings');
const offlineURL = uiURL('offline');

app.setName('Maxweb');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('lang', 'ru');

let mainWindow, settingsView, tray, store, updater;
let quitting = false, switching = false, activePane = 'account';
let autoCheckTimer, initialCheckTimer, cleanupTimer;
const runtimes = new Map();
const activeNotifications = new Set();
const preferences = () => store.get();
const activeId = () => preferences().activeAccountId;
const activeRuntime = () => runtimes.get(activeId());

function shellState() {
  const state = preferences();
  return {
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
  app.dock?.setBadge(total > 99 ? '99+' : total ? String(total) : '');
}
function layout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const bounds = { x: SIDEBAR, y: 0, width: Math.max(1, width - SIDEBAR), height };
  for (const [id, runtime] of runtimes) {
    runtime.view.setBounds(bounds);
    runtime.view.setVisible(activePane === 'account' && id === activeId());
  }
  if (settingsView) { settingsView.setBounds(bounds); settingsView.setVisible(activePane === 'settings'); }
}
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); app.focus({ steal: true }); mainWindow.focus();
}
function selectAccount(id, focus = true) {
  if (!preferences().accounts.some(account => account.id === id)) throw new Error('Аккаунт не найден.');
  switching = true;
  try {
    if (activeId() !== id) store.set({ activeAccountId: id });
    activePane = 'account';
    const runtime = runtimes.get(id) || createAccountView(preferences().accounts.find(a => a.id === id));
    layout();
    mainWindow.setTitle(`${preferences().accounts.find(a => a.id === id).name} — MAX`);
    if (focus) { showWindow(); runtime.view.webContents.focus(); }
    broadcast();
  } finally { switching = false; }
  return shellState();
}
function addAccount(name) {
  const account = newAccount(name);
  store.set({ accounts: [...preferences().accounts, account] });
  createAccountView(account);
  selectAccount(account.id);
  return shellState();
}
function renameAccount(id, name) {
  if (!preferences().accounts.some(a => a.id === id)) throw new Error('Аккаунт не найден.');
  store.set({ accounts: preferences().accounts.map(a => a.id === id ? { ...a, name: accountName(name) } : a) });
  if (id === activeId() && activePane === 'account') mainWindow.setTitle(`${accountName(name)} — MAX`);
  broadcast(); return shellState();
}
function external(url) { if (isExternalURL(url)) void shell.openExternal(url).catch(() => {}); }
function secureNavigation(contents, id) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isMaxURL(url)) { selectAccount(id); void contents.loadURL(url).catch(() => {}); }
    else external(url);
    return { action: 'deny' };
  });
  const guard = event => { if (!isMaxURL(event.url)) { event.preventDefault(); external(event.url); } };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', event => event.preventDefault());
}
function configureSession(ses) {
  ses.setUserAgent(ses.getUserAgent(), 'ru-RU,ru,en-US,en');
  const topURL = contents => contents && !contents.isDestroyed() ? contents.getURL() : '';
  ses.setPermissionCheckHandler((contents, permission, origin) => mayUsePermission(permission, origin, topURL(contents), preferences().notifications));
  ses.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    if (!mayUsePermission(permission, details.requestingUrl, topURL(contents), preferences().notifications)) return callback(false);
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
    item.setSaveDialogOptions({ title: 'Сохранить файл из MAX', buttonLabel: 'Сохранить' });
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
  await runtime.view.webContents.loadURL(MAX_URL).catch(() => {});
}
function createAccountView(account) {
  const ses = session.fromPartition(accountPartition(account.id));
  configureSession(ses);
  const view = new WebContentsView({ webPreferences: {
    preload: path.join(__dirname, 'account-preload.cjs'),
    session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false, spellcheck: true
  } });
  view.setBackgroundColor('#17181c');
  view.setVisible(false);
  mainWindow.contentView.addChildView(view);
  const runtime = { view, session: ses, unread: '', status: 'loading', retryTimer: null };
  runtimes.set(account.id, runtime);
  const contents = view.webContents;
  secureNavigation(contents, account.id);
  contents.on('page-title-updated', (_event, title) => { runtime.unread = unreadBadge(title); broadcast(); });
  contents.on('did-finish-load', () => {
    runtime.status = contents.getURL() === offlineURL ? 'offline' : 'ready'; broadcast();
  });
  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isMaxURL(url) || quitting) return;
    clearTimeout(runtime.retryTimer);
    void contents.loadURL(offlineURL).then(() => {
      runtime.status = 'offline'; broadcast();
      runtime.retryTimer = setTimeout(() => loadMax(account.id), 15000);
    }).catch(() => {});
  });
  contents.on('render-process-gone', () => {
    if (!quitting) { clearTimeout(runtime.retryTimer); runtime.retryTimer = setTimeout(() => loadMax(account.id), 1500); }
  });
  void loadMax(account.id);
  layout();
  return runtime;
}
function localPreferences(preload) {
  return { preload: path.join(__dirname, preload), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };
}
function showSettings() {
  if (!settingsView) {
    settingsView = new WebContentsView({ webPreferences: localPreferences('settings-preload.cjs') });
    settingsView.setBackgroundColor('#f6f5fa');
    mainWindow.contentView.addChildView(settingsView);
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
    backgroundColor: '#f1eff7', show: false, webPreferences: localPreferences('shell-preload.cjs')
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('did-finish-load', broadcast);
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
  selectAccount(activeId(), false);
}
function testNotification() {
  return new Promise((resolve, reject) => {
    if (!Notification.isSupported()) return reject(new Error('Уведомления недоступны в этой системе.'));
    const account = preferences().accounts.find(a => a.id === activeId());
    const notification = new Notification({ title: 'Maxweb', subtitle: account.name, body: 'Пробное уведомление. Нажмите, чтобы открыть этот аккаунт.', sound: 'default' });
    activeNotifications.add(notification);
    let settled = false;
    const timeout = setTimeout(() => { if (!settled) { settled = true; resolve({ delivered: false }); } }, 5000);
    notification.on('show', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve({ delivered: true }); } });
    notification.on('failed', (_event, message) => {
      activeNotifications.delete(notification);
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(message || 'macOS не разрешила уведомление.')); }
    });
    notification.on('click', () => selectAccount(account.id));
    notification.on('close', () => activeNotifications.delete(notification));
    notification.show();
  });
}
function trusted(contents, url, event) {
  return contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame && event.senderFrame.url === url;
}
function bindIPC() {
  ipcMain.on('account:notification-click', event => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isMaxURL(event.senderFrame.url)) return;
    for (const [id, runtime] of runtimes) {
      if (runtime.view.webContents === event.sender) { selectAccount(id); return; }
    }
  });
  const handle = (channel, audience, handler) => ipcMain.handle(channel, async (event, ...args) => {
    const allowed = audience === 'shell'
      ? trusted(mainWindow?.webContents, shellURL, event)
      : trusted(settingsView?.webContents, settingsURL, event);
    if (!allowed) throw new Error('Недоверенный источник запроса.');
    return handler(...args);
  });
  handle('shell:get', 'shell', shellState);
  handle('accounts:select', 'shell', selectAccount);
  handle('accounts:add', 'shell', addAccount);
  handle('accounts:rename', 'shell', renameAccount);
  handle('shell:settings', 'shell', () => { showSettings(); });
  handle('settings:get', 'settings', () => ({ notifications: preferences().notifications, openAtLogin: app.getLoginItemSettings().openAtLogin, packaged: app.isPackaged, version: APP_VERSION, arch: process.arch, updates: preferences().updates, update: updater.snapshot() }));
  handle('settings:notifications', 'settings', enabled => {
    if (typeof enabled !== 'boolean') throw new Error('Неверное значение.');
    store.set({ notifications: enabled });
    for (const { view } of runtimes.values()) if (isMaxURL(view.webContents.getURL())) view.webContents.reload();
    return enabled;
  });
  handle('settings:login', 'settings', enabled => {
    if (!app.isPackaged || typeof enabled !== 'boolean') throw new Error('Автозапуск доступен в установленном приложении.');
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false });
    return app.getLoginItemSettings().openAtLogin;
  });
  handle('settings:test', 'settings', testNotification);
  handle('settings:system', 'settings', () => shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension'));
  handle('settings:open', 'settings', () => { selectAccount(activeId()); });
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
      { label: 'О Maxweb', click: () => dialog.showMessageBox({ type: 'info', message: `Maxweb ${APP_VERSION}`, detail: 'Независимый клиент веб-версии MAX для Apple Silicon.\nАккаунты сохраняют отдельные авторизации и работают в фоне.\nПолный выход — ⌘Q.' }) },
      { label: 'Проверить обновления…', click: checkUpdates },
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
      { label: 'Перезагрузить MAX', accelerator: 'CmdOrCtrl+R', click: () => loadMax() },
      { type: 'separator' }, { role: 'resetZoom', label: 'Фактический размер' }, { role: 'zoomIn', label: 'Увеличить' }, { role: 'zoomOut', label: 'Уменьшить' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'На весь экран' }
    ] },
    { label: 'Окно', submenu: [{ role: 'minimize', label: 'Свернуть' }, { role: 'zoom', label: 'Масштабировать' }, { role: 'close', label: 'Закрыть окно' }] },
    { label: 'Помощь', submenu: [{ label: 'Проверить уведомления', click: notificationTest }, { label: 'Справка MAX', click: () => external('https://help.max.ru/') }] }
  ]));
  const image = nativeImage.createFromPath(path.join(__dirname, '../assets/trayTemplate.png')); image.setTemplateImage(true);
  tray = new Tray(image); tray.setToolTip('Maxweb — все аккаунты работают в фоне');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть MAX', click: showWindow }, { label: 'Настройки и обновления…', click: showSettings },
    { type: 'separator' }, { label: 'Завершить Maxweb', click: () => app.quit() }
  ]));
  tray.on('click', showWindow);
}
function cycleAccount(direction) {
  const accounts = preferences().accounts;
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
  quitting = true; clearTimeout(initialCheckTimer); clearTimeout(cleanupTimer); clearInterval(autoCheckTimer);
  for (const runtime of runtimes.values()) clearTimeout(runtime.retryTimer);
});
app.on('window-all-closed', () => {});
const ready = hasLock ? app.whenReady().then(async () => {
  store = createStore(app.getPath('userData'));
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
  const autoCheck = () => { if (preferences().updates.autoCheck && preferences().updates.repository) void updater.check().catch(() => {}); };
  if (app.isPackaged) {
    initialCheckTimer = setTimeout(autoCheck, 15000);
    autoCheckTimer = setInterval(autoCheck, 6 * 60 * 60 * 1000);
    cleanupTimer = setTimeout(() => updater.finishPending(), 15000);
  }
  powerMonitor.on('resume', () => {
    for (const [id, runtime] of runtimes) if (runtime.view.webContents.getURL() === offlineURL) void loadMax(id);
    autoCheck();
  });
}) : Promise.resolve();
ready.catch(error => { dialog.showErrorBox('Не удалось запустить Maxweb', error.message); app.quit(); });
module.exports = {
  ready, showWindow, showSettings, loadMax, testNotification, addAccount, renameAccount, selectAccount, flushSessions,
  getMainWindow: () => mainWindow, getSession: (id = activeId()) => runtimes.get(id)?.session,
  getAccountContents: (id = activeId()) => runtimes.get(id)?.view.webContents,
  getState: shellState, getUpdater: () => updater
};
