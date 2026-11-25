'use strict';
const $ = id => document.getElementById(id);
let state, editing = null, editingAccount = null;
let draggingId = null, suppressAccountClickUntil = 0;
let autoTouchAttempted = false, unlocking = false;
function maybeAutoTouchID() {
  if (!state?.locked || !state.security.touchID || !state.security.touchIDAvailable || autoTouchAttempted || unlocking || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  autoTouchAttempted = true;
  void unlock(true);
}
window.addEventListener('focus', maybeAutoTouchID);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoTouchAttempted = false; else maybeAutoTouchID(); });
const serviceName = account => ({ max: 'MAX', telegram: 'Telegram', whatsapp: 'WhatsApp', vk: 'VK Мессенджер' })[account?.service || 'max'];
const error = message => { $('error').textContent = message; };
const action = async operation => { try { error(''); return await operation(); } catch (e) { error(e.message); } };
function edit(account = null) {
  $('account-picker').hidden = true;
  if (state.sidebarCollapsed) void window.maxwebShell.collapse(false);
  editingAccount = account; editing = account?.id || null;
  $('profile-name').hidden = !account;
  $('logout-account').hidden = !account;
  $('profile-name').textContent = account?.profileName ? `Использовать имя ${serviceName(account)}: ${account.profileName}` : `Получать имя из ${serviceName(account)} автоматически`;
  $('form-title').textContent = 'Настройки аккаунта';
  $('save').textContent = account ? 'Сохранить' : 'Добавить';
  $('account-name').value = account?.name || '';
  $('account-form').hidden = false; $('add').hidden = true;
  $('account-name').focus(); $('account-name').select();
}
function closeForm() { $('account-picker').hidden = true; $('account-form').hidden = true; $('add').hidden = false; editing = null; error(''); }
function render(next) {
  if (draggingId && !next.locked) { state = next; return; }
  if (next.locked) finishDrag();
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
    const row = document.createElement('div'); row.className = `account-row${account.active ? ' active' : ''}`; row.dataset.accountId = account.id;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'account';
    button.setAttribute('aria-label', account.name);
    button.title = `${account.name}${index < 9 ? ` · ⌘${index + 1}` : ''} · Перетащите для перемещения · Правый клик — настройки`;
    button.draggable = true; button.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    if (account.active) button.setAttribute('aria-current', 'page');
    const avatar = document.createElement('span'); avatar.className = `avatar tone-${[...account.id].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) >>> 0, 0) % 5}`; avatar.setAttribute('aria-hidden', 'true');
    const initials = document.createElement('span'); initials.className = 'avatar-initials'; initials.textContent = account.name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase('ru'); avatar.append(initials);
    if (account.avatar) {
      const image = document.createElement('img'); image.src = account.avatar; image.alt = ''; image.draggable = false;
      image.addEventListener('error', () => image.remove(), { once: true });
      avatar.append(image);
    }
    const serviceMark = document.createElement('span'); serviceMark.className = `service-mark ${account.service || 'max'}`;
    serviceMark.title = serviceName(account); serviceMark.setAttribute('aria-hidden', 'true');
    if (account.service === 'telegram') serviceMark.innerHTML = '<svg viewBox="0 0 24 24"><path d="m3 11 17-7-4 16-5-5 5-6-7 5-6-3Z"/></svg>';
    else if (account.service === 'whatsapp') serviceMark.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.4-4.2A8 8 0 1 1 20 11.5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 7c0 5 4 8 8 8l1-2-3-1-1 1-3-3 1-1-1-3Z"/></svg>';
    else if (account.service === 'vk') serviceMark.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 5h4c.2 5 1.5 8 3 8V5h4v5c1.6-.5 3.4-3 4-5h4c-.7 3-2.7 5.5-4.5 7 2 1.3 4.2 4 4.8 7H18c-.7-2-2.5-4-4-4v4h-2C6 19 3 14 3 5Z"/></svg>';
    else serviceMark.textContent = 'M';
    const label = document.createElement('span'); label.className = 'account-label';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = account.name;
    const status = document.createElement('span'); status.className = 'account-status'; status.textContent = account.status === 'offline' ? 'Нет соединения' : account.status === 'loading' ? 'Подключение…' : account.notifications === false ? 'Уведомления выкл.' : serviceName(account);
    label.append(name, status); button.append(avatar, label, serviceMark);
    button.addEventListener('click', () => { if (Date.now() >= suppressAccountClickUntil) void action(() => window.maxwebShell.select(account.id)); });
    bindAccountReorder(row, button, account.id);
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
const addAccount = service => action(async () => {
  $('add').disabled = true; $('empty-add').disabled = true;
  try { closeForm(); render(await window.maxwebShell.add(service)); }
  finally { $('add').disabled = false; $('empty-add').disabled = false; }
});
function showAccountPicker() {
  if (state.sidebarCollapsed) void window.maxwebShell.collapse(false);
  closeForm(); $('account-picker').hidden = false; $('add').hidden = true;
  $('account-picker').querySelector('[data-service]').focus();
}
$('add').addEventListener('click', showAccountPicker);
$('empty-add').addEventListener('click', showAccountPicker);
$('picker-close').addEventListener('click', closeForm);
for (const button of $('account-picker').querySelectorAll('[data-service]')) button.addEventListener('click', () => addAccount(button.dataset.service));
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
function finishDrag() {
  draggingId = null;
  document.body.classList.remove('reordering');
  for (const row of $('accounts').children) row.classList.remove('dragging', 'drop-before', 'drop-after');
}
async function saveAccountOrder(ids, focusId) {
  const next = await window.maxwebShell.reorder(ids); render(next);
  if (focusId) [...$('accounts').querySelectorAll('.account-row')].find(row => row.dataset.accountId === focusId)?.querySelector('.account').focus();
}
function bindAccountReorder(row, button, id) {
  button.addEventListener('dragstart', event => {
    if (state.locked) { event.preventDefault(); return; }
    draggingId = id; closeForm();
    event.dataTransfer.setData('application/x-maxweb-account', id); event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging'); document.body.classList.add('reordering');
  });
  button.addEventListener('dragend', () => { suppressAccountClickUntil = Date.now() + 200; finishDrag(); render(state); });
  row.addEventListener('dragover', event => {
    if (!draggingId || draggingId === id) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    for (const item of $('accounts').children) item.classList.remove('drop-before', 'drop-after');
    const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    row.classList.add(after ? 'drop-after' : 'drop-before');
    const bounds = $('accounts').getBoundingClientRect();
    if (event.clientY < bounds.top + 24) $('accounts').scrollTop -= 14;
    else if (event.clientY > bounds.bottom - 24) $('accounts').scrollTop += 14;
  });
  row.addEventListener('dragleave', event => { if (!row.contains(event.relatedTarget)) row.classList.remove('drop-before', 'drop-after'); });
  row.addEventListener('drop', event => {
    if (!draggingId || !event.dataTransfer.types.includes('application/x-maxweb-account')) return;
    event.preventDefault();
    const source = draggingId, after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    const ids = state.accounts.map(account => account.id).filter(accountId => accountId !== source);
    const target = ids.indexOf(id);
    suppressAccountClickUntil = Date.now() + 200; finishDrag();
    if (target < 0) { render(state); return; }
    ids.splice(target + (after ? 1 : 0), 0, source);
    void action(() => saveAccountOrder(ids));
  });
  button.addEventListener('keydown', event => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const ids = state.accounts.map(account => account.id), index = ids.indexOf(id);
    if (index < 0) return;
    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void action(() => saveAccountOrder(ids, id));
  });
}
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
