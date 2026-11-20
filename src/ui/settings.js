'use strict';
const $ = id => document.getElementById(id);
let packaged = false;
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
async function init() {
  try {
    const state = await window.maxweb.get();
    packaged = state.packaged;
    $('notifications').checked = state.notifications;
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
void init();
