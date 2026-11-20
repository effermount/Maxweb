'use strict';
const $ = id => document.getElementById(id);
let state, editing = null;
const error = message => { $('error').textContent = message; };
const action = async operation => { try { error(''); return await operation(); } catch (e) { error(e.message); } };
function edit(account = null) {
  editing = account?.id || null;
  $('form-title').textContent = account ? 'Название аккаунта' : 'Новый аккаунт';
  $('save').textContent = account ? 'Сохранить' : 'Добавить';
  $('account-name').value = account?.name || '';
  $('account-form').hidden = false; $('add').hidden = true;
  $('account-name').focus(); $('account-name').select();
}
function closeForm() { $('account-form').hidden = true; $('add').hidden = false; editing = null; error(''); }
function render(next) {
  state = next;
  $('accounts').replaceChildren();
  for (const [index, account] of state.accounts.entries()) {
    const row = document.createElement('div'); row.className = `account-row${account.active ? ' active' : ''}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'account';
    button.title = `${account.name}${index < 9 ? ` · ⌘${index + 1}` : ''}`;
    if (account.active) button.setAttribute('aria-current', 'page');
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = account.name[0].toLocaleUpperCase('ru'); avatar.setAttribute('aria-hidden', 'true');
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
