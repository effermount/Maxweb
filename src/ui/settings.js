'use strict';
const $ = id => document.getElementById(id);
let packaged = false, banner, security, selectedTheme = 'system', selectedMaxZoom = 100;
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
async function init() {
  try {
    const state = await window.maxweb.get();
    packaged = state.packaged;
    renderTheme(state.theme);
    renderMaxZoom(state.maxZoom);
    $('notifications').checked = state.notifications;
    renderBanner(state.banner); renderSecurity(state.security);
    $('login').checked = state.openAtLogin;
    $('login').disabled = !state.packaged;
    if (!state.packaged) $('login-hint').textContent = 'Доступно после установки приложения';
    $('version').textContent = `Maxweb ${state.version} · ${state.arch === 'arm64' ? 'Apple Silicon' : state.arch}`;
    $('repository').value = state.updates.repository;
    $('auto-update').checked = state.updates.autoCheck;
    renderUpdate(state.update);
  } catch (error) { status(error.message, true); }
}
$('notifications').addEventListener('change', async event => {
  const control = event.target;
  control.disabled = true;
  try { await window.maxweb.notifications(control.checked); status(control.checked ? 'Уведомления из MAX разрешены.' : 'Уведомления из MAX отключены.'); }
  catch (error) { control.checked = !control.checked; status(error.message, true); }
  finally { control.disabled = false; }
});
$('login').addEventListener('change', async event => {
  const control = event.target;
  control.disabled = true;
  try { control.checked = await window.maxweb.login(control.checked); status('Настройка автозапуска сохранена.'); }
  catch (error) { control.checked = !control.checked; status(error.message, true); }
  finally { control.disabled = false; }
});
$('test').addEventListener('click', async () => {
  $('test').disabled = true;
  status('Отправляем пробное уведомление…');
  try {
    const result = await window.maxweb.test();
    status(result.delivered ? 'macOS приняла уведомление. Если баннер не виден, проверьте «Фокусирование» и настройки macOS.' : 'Баннер не подтверждён. Разрешите уведомления для Maxweb в настройках macOS.');
  } catch (error) { status(error.message, true); }
  finally { $('test').disabled = false; }
});
$('system').addEventListener('click', () => window.maxweb.system().catch(error => status(error.message, true)));
$('open').addEventListener('click', () => window.maxweb.open().catch(error => status(error.message, true)));
function renderUpdate(state) {
  const busy = ['checking', 'downloading', 'installing'].includes(state.status);
  $('update-message').textContent = state.message;
  $('update-message').classList.toggle('error', state.status === 'error');
  $('update-title').textContent = state.version ? `Maxweb ${state.version}` : 'Обновления Maxweb';
  $('update-version').textContent = `Установлена ${state.currentVersion}`;
  $('update-check').disabled = busy;
  $('update-download').hidden = state.status !== 'available';
  $('update-download').disabled = busy;
  $('update-install').hidden = !['ready', 'installing'].includes(state.status);
  $('update-install').disabled = busy || !packaged;
  $('update-install').title = packaged ? 'Перезапустить приложение и сохранить все аккаунты' : 'Доступно в установленном приложении';
  $('update-progress').hidden = state.status !== 'downloading';
  $('update-progress').value = state.progress || 0;
  $('release-notes').hidden = !state.notes;
  $('release-notes').textContent = state.notes || '';
  for (const id of ['repository', 'update-save', 'auto-update']) $(id).disabled = busy;
}
async function updateAction(operation) {
  try { status(''); await operation(); }
  catch (error) { status(error.message, true); }
}
$('update-save').addEventListener('click', () => updateAction(async () => {
  const result = await window.maxweb.updateConfigure($('repository').value, $('auto-update').checked);
  $('repository').value = result.repository;
  status('Источник обновлений сохранён.');
}));
$('auto-update').addEventListener('change', () => updateAction(() => window.maxweb.updateConfigure($('repository').value, $('auto-update').checked)));
$('update-check').addEventListener('click', () => updateAction(() => window.maxweb.updateCheck()));
$('update-download').addEventListener('click', () => updateAction(() => window.maxweb.updateDownload()));
$('update-install').addEventListener('click', () => updateAction(() => window.maxweb.updateInstall()));
window.maxweb.onUpdate(renderUpdate);


const bannerIDs = { showAccount: 'banner-account', showSender: 'banner-sender', showText: 'banner-text', sound: 'banner-sound' };
function renderBanner(value) {
  banner = value;
  for (const [key, id] of Object.entries(bannerIDs)) $(id).checked = banner[key];
  $('banner-text').disabled = !banner.showSender;
  $('preview-title').textContent = banner.showSender ? 'Отправитель MAX' : 'Maxweb';
  $('preview-account').textContent = banner.showAccount ? 'Название вашего аккаунта' : '';
  $('preview-body').textContent = banner.showSender && banner.showText ? 'Так будет выглядеть текст сообщения' : 'Новое сообщение в MAX';
}
for (const [key, id] of Object.entries(bannerIDs)) $(id).addEventListener('change', async () => {
  const previous = banner;
  for (const control of Object.values(bannerIDs)) $(control).disabled = true;
  try { renderBanner(await window.maxweb.banner({ ...banner, [key]: $(id).checked })); status('Содержимое баннеров сохранено.'); }
  catch (error) { renderBanner(previous); status(error.message, true); }
  finally { for (const control of Object.values(bannerIDs)) $(control).disabled = false; $('banner-text').disabled = !banner.showSender; }
});
function renderSecurity(value) {
  security = value;
  $('security-state').textContent = value.enabled ? 'Защита включена · ⌘L для блокировки' : 'Блокировка выключена';
  $('lock-now').hidden = !value.enabled;
  $('current-pin-label').hidden = !value.enabled;
  $('new-pin-label').textContent = value.enabled ? 'Новый PIN (пусто — оставить текущий)' : 'PIN-код: от 4 до 8 цифр';
  $('security-save').textContent = value.enabled ? 'Сохранить защиту' : 'Включить блокировку';
  $('security-disable').hidden = !value.enabled;
  $('security-touch-id').checked = value.touchID && value.touchIDAvailable;
  $('security-touch-id').disabled = !value.touchIDAvailable;
  $('touch-id-hint').textContent = value.touchIDAvailable ? 'PIN остаётся запасным способом' : 'Touch ID не настроен или недоступен на этом Mac';
  $('idle-seconds').value = String(value.idleSeconds);
  for (const id of ['current-pin', 'new-pin', 'confirm-pin']) $(id).value = '';
}
async function saveSecurity(disable = false) {
  const fields = [...$('security-form').querySelectorAll('input, select, button')];
  for (const field of fields) field.disabled = true;
  try {
    const value = await window.maxweb.security({ currentPIN: $('current-pin').value, pin: $('new-pin').value, confirmPIN: $('confirm-pin').value,
      touchID: $('security-touch-id').checked, idleSeconds: Number($('idle-seconds').value), disable });
    renderSecurity(value); $('security-feedback').textContent = disable ? 'Блокировка выключена.' : 'Настройки защиты сохранены.'; $('security-feedback').classList.remove('error');
  } catch (error) { $('security-feedback').textContent = error.message; $('security-feedback').classList.add('error'); }
  finally { for (const field of fields) field.disabled = false; $('security-touch-id').disabled = !security.touchIDAvailable; }
}
$('security-form').addEventListener('submit', event => { event.preventDefault(); void saveSecurity(); });
$('security-disable').addEventListener('click', () => saveSecurity(true));
$('lock-now').addEventListener('click', () => window.maxweb.lock().catch(error => status(error.message, true)));

window.maxweb.onLock(() => { for (const id of ['current-pin', 'new-pin', 'confirm-pin']) $(id).value = ''; });


function renderTheme(state) {
  selectedTheme = state.source;
  $('theme').value = state.source;
  $('theme-hint').textContent = state.source === 'system' ? `Как в macOS · сейчас ${state.dark ? 'тёмная' : 'светлая'}` : 'Выбрана вручную для Maxweb';
}
$('theme').addEventListener('change', async () => {
  const previous = selectedTheme;
  $('theme').disabled = true;
  try { renderTheme(await window.maxweb.theme($('theme').value)); $('theme-feedback').textContent = 'Тема сохранена. Изменения применены сразу.'; $('theme-feedback').classList.remove('error'); }
  catch (error) { $('theme').value = previous; $('theme-feedback').textContent = error.message; $('theme-feedback').classList.add('error'); }
  finally { $('theme').disabled = false; }
});
window.maxweb.onTheme(renderTheme);

function renderMaxZoom(percent) {
  selectedMaxZoom = percent;
  $('max-zoom').value = String(percent);
  $('max-zoom-reset').disabled = percent === 100;
}
async function saveMaxZoom(percent) {
  $('max-zoom').disabled = true; $('max-zoom-reset').disabled = true;
  try {
    renderMaxZoom(await window.maxweb.maxZoom(percent));
    $('max-zoom-feedback').textContent = `Масштаб MAX: ${selectedMaxZoom}%. Сохранён для всех аккаунтов.`;
    $('max-zoom-feedback').classList.remove('error');
  } catch (error) {
    renderMaxZoom(selectedMaxZoom);
    $('max-zoom-feedback').textContent = error.message; $('max-zoom-feedback').classList.add('error');
  } finally { $('max-zoom').disabled = false; $('max-zoom-reset').disabled = selectedMaxZoom === 100; }
}
$('max-zoom').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('max-zoom').blur(); } });
$('max-zoom').addEventListener('change', () => saveMaxZoom($('max-zoom').valueAsNumber));
$('max-zoom-reset').addEventListener('click', () => saveMaxZoom(100));
window.maxweb.onMaxZoom(renderMaxZoom);
void init();
