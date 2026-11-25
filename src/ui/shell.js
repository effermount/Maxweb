'use strict';
const $ = id => document.getElementById(id);
let state, editing = null, editingAccount = null;
let autoTouchAttempted = false, unlocking = false;
function maybeAutoTouchID() {
  if (!state?.locked || !state.security.touchID || !state.security.touchIDAvailable || autoTouchAttempted || unlocking || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  autoTouchAttempted = true;
  void unlock(true);
}
window.addEventListener('focus', maybeAutoTouchID);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoTouchAttempted = false; else maybeAutoTouchID(); });
const error = message => { $('error').textContent = message; };
const action = async operation => { try { error(''); return await operation(); } catch (e) { error(e.message); } };
function edit(account = null) {
  if (state.sidebarCollapsed) void window.maxwebShell.collapse(false);
  editingAccount = account; editing = account?.id || null;
  $('profile-name').hidden = !account;
  $('logout-account').hidden = !account;
  $('profile-name').textContent = account?.profileName ? `Использовать имя MAX: ${account.profileName}` : 'Получать имя из MAX автоматически';
  $('form-title').textContent = 'Настройки аккаунта';
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
  $('empty-state').hidden = !!state.locked || state.accounts?.length !== 0 || state.pane === 'settings';
  if (state.locked) {
    $('accounts').replaceChildren(); closeForm();
    const biometric = state.security.touchID && state.security.touchIDAvailable;
    $('touch-id').hidden = !biometric; $('code-divider').hidden = !biometric;
    $('lock-description').textContent = biometric ? 'Коснитесь датчика Touch ID, чтобы продолжить' : 'Введите код доступа, чтобы открыть аккаунты';
    if (!wasLocked) { autoTouchAttempted = false; $('unlock-pin').value = ''; $('unlock-error').textContent = ''; if (!biometric) $('unlock-pin').focus(); }
    requestAnimationFrame(maybeAutoTouchID);
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
    button.title = `${account.name}${index < 9 ? ` · ⌘${index + 1}` : ''} · Правый клик — настройки`;
    if (account.active) button.setAttribute('aria-current', 'page');
    const avatar = document.createElement('span'); avatar.className = `avatar tone-${index % 5}`; avatar.textContent = account.name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase('ru'); avatar.setAttribute('aria-hidden', 'true');
    if (account.avatar) {
      const image = document.createElement('img'); image.src = account.avatar; image.alt = '';
      image.addEventListener('error', () => image.remove(), { once: true });
      avatar.append(image);
    }
    const label = document.createElement('span'); label.className = 'account-label';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = account.name;
    const status = document.createElement('span'); status.className = 'account-status'; status.textContent = account.status === 'offline' ? 'Нет соединения' : account.status === 'loading' ? 'Подключение…' : account.notifications === false ? 'Уведомления выкл.' : 'MAX';
    label.append(name, status); button.append(avatar, label);
    button.addEventListener('click', () => action(() => window.maxwebShell.select(account.id)));
    const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'rename'; rename.textContent = '✎'; rename.title = `Настройки аккаунта «${account.name}»`; rename.setAttribute('aria-label', rename.title);
    rename.addEventListener('click', () => edit(account));
    button.addEventListener('contextmenu', event => { event.preventDefault(); edit(account); });
    const mute = document.createElement('button'); mute.type = 'button'; mute.className = `account-mute${account.notifications === false ? ' is-muted' : ''}`;
    mute.title = `${account.notifications === false ? 'Включить' : 'Выключить'} системные уведомления: ${account.name}`;
    mute.setAttribute('aria-label', mute.title); mute.setAttribute('aria-pressed', String(account.notifications === false));
    mute.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/><path class="mute-slash" d="m3 3 18 18"/></svg>';
    mute.addEventListener('click', () => action(async () => { mute.disabled = true; try { render(await window.maxwebShell.notifications(account.id, account.notifications === false)); } finally { mute.disabled = false; } }));
    row.append(button, mute, rename);
    if (account.unread) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = account.unread; row.append(badge); }
    $('accounts').append(row);
  }
  $('version').textContent = `Maxweb ${state.version}`;
  $('settings').setAttribute('aria-current', state.pane === 'settings' ? 'page' : 'false');
  $('update-alert').hidden = !['available', 'downloading', 'ready'].includes(state.update.status);
  $('update-alert').textContent = state.update.status === 'ready' ? 'Обновление готово к установке ↗' : state.update.status === 'downloading' ? `Обновление · ${state.update.progress}%` : `Доступна версия ${state.update.version} ↗`;
}
const addAccount = () => action(async () => {
  $('add').disabled = true; $('empty-add').disabled = true;
  try { closeForm(); render(await window.maxwebShell.add()); }
  finally { $('add').disabled = false; $('empty-add').disabled = false; }
});
$('add').addEventListener('click', addAccount);
$('empty-add').addEventListener('click', addAccount);
$('logout-account').addEventListener('click', () => action(async () => {
  const id = editingAccount?.id;
  if (!id) return;
  $('logout-account').disabled = true;
  try { const next = await window.maxwebShell.logout(id); closeForm(); render(next); }
  finally { $('logout-account').disabled = false; }
}));
$('cancel').addEventListener('click', closeForm);
$('account-form').addEventListener('submit', async event => {
  event.preventDefault(); $('save').disabled = true;
  try {
    const next = await window.maxwebShell.rename(editing, $('account-name').value);
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
  if (unlocking) return;
  unlocking = true; autoTouchAttempted = true;
  $('touch-id-label').textContent = biometric ? 'Проверяем Touch ID…' : 'Разблокировать с Touch ID';
  $('unlock').disabled = true; $('touch-id').disabled = true; $('unlock-error').textContent = '';
  try {
    if (biometric) await window.maxwebShell.touchID(); else await window.maxwebShell.unlock($('unlock-pin').value);
    $('unlock-pin').value = ''; render(await window.maxwebShell.get());
  } catch (error) { $('unlock-error').textContent = biometric ? 'Touch ID не выполнен. Повторите попытку или введите код.' : error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); $('unlock-pin').value = ''; $('unlock-pin').focus(); }
  finally { unlocking = false; $('unlock').disabled = false; $('touch-id').disabled = false; $('touch-id-label').textContent = 'Разблокировать с Touch ID'; }
}
$('unlock-form').addEventListener('submit', event => { event.preventDefault(); void unlock(false); });
$('touch-id').addEventListener('click', () => unlock(true));
