'use strict';
const $ = id => document.getElementById(id);
let state, editing = null, editingAccount = null;
const error = message => { $('error').textContent = message; };
const action = async operation => { try { error(''); return await operation(); } catch (e) { error(e.message); } };
function edit(account = null) {
  if (state.sidebarCollapsed) void window.maxwebShell.collapse(false);
  editingAccount = account; editing = account?.id || null;
  $('profile-name').hidden = !account;
  $('profile-name').textContent = account?.profileName ? `Использовать имя MAX: ${account.profileName}` : 'Получать имя из MAX автоматически';
  $('form-title').textContent = account ? 'Название аккаунта' : 'Новый аккаунт';
  $('save').textContent = account ? 'Сохранить' : 'Добавить';
  $('account-name').value = account?.name || '';
  $('account-form').hidden = false; $('add').hidden = true;
  $('account-name').focus(); $('account-name').select();
}
function closeForm() { $('account-form').hidden = true; $('add').hidden = false; editing = null; error(''); }
function render(next) {
  const wasLocked = state?.locked;
  state = next;
  document.body.classList.remove('loading');
  document.body.classList.toggle('locked', !!state.locked);
  $('lock-screen').hidden = !state.locked;
  if (state.locked) {
    $('accounts').replaceChildren(); closeForm();
    $('touch-id').hidden = !state.security.touchID || !state.security.touchIDAvailable;
    if (!wasLocked) { $('unlock-pin').value = ''; $('unlock-error').textContent = ''; $('unlock-pin').focus(); }
    return;
  }
  document.body.classList.toggle('collapsed', state.sidebarCollapsed);
  $('collapse').setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  $('collapse').title = state.sidebarCollapsed ? 'Развернуть панель' : 'Свернуть панель';
  $('collapse').setAttribute('aria-label', $('collapse').title);
  $('lock').hidden = !state.security.enabled;
  $('accounts').replaceChildren();
  for (const [index, account] of state.accounts.entries()) {
    const row = document.createElement('div'); row.className = `account-row${account.active ? ' active' : ''}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'account';
    button.setAttribute('aria-label', account.name);
    button.title = `${account.name}${index < 9 ? ` · ⌘${index + 1}` : ''}`;
    if (account.active) button.setAttribute('aria-current', 'page');
    const avatar = document.createElement('span'); avatar.className = `avatar tone-${index % 5}`; avatar.textContent = account.name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase('ru'); avatar.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'account-label';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = account.name;
    const status = document.createElement('span'); status.className = 'account-status'; status.textContent = account.status === 'offline' ? 'Нет соединения' : account.status === 'loading' ? 'Подключение…' : 'MAX';
    label.append(name, status); button.append(avatar, label);
    button.addEventListener('click', () => action(() => window.maxwebShell.select(account.id)));
    const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'rename'; rename.textContent = '✎'; rename.title = `Переименовать «${account.name}»`; rename.setAttribute('aria-label', rename.title);
    rename.addEventListener('click', () => edit(account));
    row.append(button, rename);
    if (account.unread) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = account.unread; row.append(badge); }
    $('accounts').append(row);
  }
  $('version').textContent = `Maxweb ${state.version}`;
  $('settings').setAttribute('aria-current', state.pane === 'settings' ? 'page' : 'false');
  $('update-alert').hidden = !['available', 'downloading', 'ready'].includes(state.update.status);
  $('update-alert').textContent = state.update.status === 'ready' ? 'Обновление готово к установке ↗' : state.update.status === 'downloading' ? `Обновление · ${state.update.progress}%` : `Доступна версия ${state.update.version} ↗`;
}
$('add').addEventListener('click', () => edit());
$('cancel').addEventListener('click', closeForm);
$('account-form').addEventListener('submit', async event => {
  event.preventDefault(); $('save').disabled = true;
  try {
    const next = editing ? await window.maxwebShell.rename(editing, $('account-name').value) : await window.maxwebShell.add($('account-name').value);
    closeForm(); render(next);
  } catch (e) { error(e.message); }
  finally { $('save').disabled = false; }
});
$('settings').addEventListener('click', () => action(() => window.maxwebShell.settings()));
$('update-alert').addEventListener('click', () => action(() => window.maxwebShell.settings()));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeForm(); });
window.maxwebShell.onState(render);
void action(async () => render(await window.maxwebShell.get()));

$('collapse').addEventListener('click', () => action(async () => { closeForm(); render(await window.maxwebShell.collapse(!state.sidebarCollapsed)); }));
$('profile-name').addEventListener('click', () => action(async () => { const next = await window.maxwebShell.profileName(editingAccount.id); closeForm(); render(next); }));
$('lock').addEventListener('click', () => action(() => window.maxwebShell.lock()));
async function unlock(biometric) {
  $('unlock').disabled = true; $('touch-id').disabled = true; $('unlock-error').textContent = '';
  try {
    if (biometric) await window.maxwebShell.touchID(); else await window.maxwebShell.unlock($('unlock-pin').value);
    $('unlock-pin').value = ''; render(await window.maxwebShell.get());
  } catch (error) { $('unlock-error').textContent = error.message; $('unlock-pin').value = ''; $('unlock-pin').focus(); }
  finally { $('unlock').disabled = false; $('touch-id').disabled = false; }
}
$('unlock-form').addEventListener('submit', event => { event.preventDefault(); void unlock(false); });
$('touch-id').addEventListener('click', () => unlock(true));
