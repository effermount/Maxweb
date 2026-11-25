'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if (['https://web.max.ru', 'https://web.telegram.org', 'https://web.whatsapp.com'].includes(location.origin)) {
  contextBridge.exposeInMainWorld('__maxwebNotifications', {
    send: request => ipcRenderer.send('account:notification', request),
    onEvent: callback => ipcRenderer.on('account:notification-event', (_event, value) => callback(value))
  });
  contextBridge.executeInMainWorld({ func: () => {
    const NativeNotification = window.Notification;
    if (typeof NativeNotification !== 'function') return;
    const bridge = window.__maxwebNotifications;
    const instances = new Map();
    class DesktopNotification extends EventTarget {
      constructor(title, options = {}) {
        super();
        if (!arguments.length) throw new TypeError('Notification title is required');
        Object.defineProperty(this, 'id', { value: crypto.randomUUID() });
        for (const [key, value] of Object.entries({ title: String(title), body: String(options.body || ''), data: options.data ?? null, tag: String(options.tag || ''), icon: String(options.icon || ''), silent: options.silent ?? null })) {
          Object.defineProperty(this, key, { value, enumerable: true });
        }
        instances.set(this.id, this);
        bridge.send({ type: 'show', id: this.id, title: this.title, body: this.body });
      }
      close() { bridge.send({ type: 'close', id: this.id }); }
      static get permission() { return NativeNotification.permission; }
      static get maxActions() { return NativeNotification.maxActions; }
      static requestPermission(callback) { return NativeNotification.requestPermission(callback); }
    }
    for (const type of ['click', 'show', 'close', 'error']) {
      Object.defineProperty(DesktopNotification.prototype, `on${type}`, {
        get() { return this[`_${type}`] || null; },
        set(callback) {
          if (this[`_${type}`]) this.removeEventListener(type, this[`_${type}`]);
          this[`_${type}`] = typeof callback === 'function' ? callback : null;
          if (this[`_${type}`]) this.addEventListener(type, this[`_${type}`]);
        }
      });
    }
    bridge.onEvent(({ id, type }) => {
      const notification = instances.get(id);
      if (!notification || !['click', 'show', 'close', 'error'].includes(type)) return;
      notification.dispatchEvent(new Event(type));
      if (type === 'close' || type === 'error') instances.delete(id);
    });
    window.Notification = DesktopNotification;
  } });
}
if (location.origin === 'https://web.max.ru') {
  // MAX stores its own profile under viewer['']. Read only that record;
  // do not scan contacts, messages, cookies or authentication records.
  let readingProfile = false, lastProfile = '', lastAvatarURL = '', avatar = '', avatarRetryAt = 0;
  async function profileAvatar(baseURL) {
    if (!baseURL) { lastAvatarURL = ''; avatar = ''; return ''; }
    if (baseURL === lastAvatarURL && (avatar || Date.now() < avatarRetryAt)) return avatar;
    if (baseURL !== lastAvatarURL) avatar = '';
    lastAvatarURL = baseURL; avatarRetryAt = Date.now() + 60000;
    try {
      const url = new URL(baseURL);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      url.searchParams.set('fn', 'sqr_128');
      const response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(8000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) return '';
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); return ''; }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bitmap = await createImageBitmap(new Blob(chunks));
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const edge = Math.min(bitmap.width, bitmap.height);
        canvas.getContext('2d').drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, 64, 64);
        avatar = canvas.toDataURL('image/png');
      } finally { bitmap.close(); }
      return avatar;
    } catch { return ''; }
  }
  async function syncProfile() {
    if (readingProfile) return;
    readingProfile = true;
    try {
      const databases = (await indexedDB.databases()).filter(db => /^max-db-\d+-\d+$/.test(db.name || ''));
      const identities = new Set(databases.map(db => db.name.split('-').at(-1)));
      if (identities.size !== 1) return;
      const newest = databases.sort((a, b) => Number(b.name.split('-')[2]) - Number(a.name.split('-')[2]))[0];
      if (!newest) return;
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(newest.name);
        request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Missing MAX database')); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        if (!db.objectStoreNames.contains('viewer')) return;
        const record = await new Promise((resolve, reject) => {
          const request = db.transaction('viewer', 'readonly').objectStore('viewer').get('');
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const contact = record?.model?.contact;
        const names = contact?.names;
        const own = names?.find(name => name.type === 'ONEME') || names?.[0];
        const name = [own?.firstName, own?.lastName].filter(value => typeof value === 'string' && value.trim()).join(' ').trim().slice(0, 40);
        if (!name || /[\x00-\x1f\x7f]/.test(name)) return;
        const image = await profileAvatar(typeof contact.baseUrl === 'string' ? contact.baseUrl : '');
        const profile = JSON.stringify({ name, avatar: image });
        if (profile !== lastProfile) { lastProfile = profile; ipcRenderer.send('account:profile', { name, avatar: image }); }
      } finally { db.close(); }
    } catch { /* MAX may change its schema; keep the saved account name. */ }
    finally { readingProfile = false; }
  }
  void syncProfile(); setInterval(syncProfile, 5000);
}
let lastActivity = 0;
for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) document.addEventListener(type, event => {
  if (event.isTrusted && Date.now() - lastActivity > 1000) { lastActivity = Date.now(); ipcRenderer.send('app:activity'); }
}, { capture: true, passive: true });

// Follow a message only after a send gesture and a corresponding DOM update.
// This inspects layout and draft emptiness, never stores or transmits message text.
if (location.origin === 'https://web.max.ru') {
  let intent = null;
  let followUntil = 0;
  let followPath = '';
  let followFrame = 0;
  const bottomSpacers = new WeakMap();
  const composerSelector = '[data-testid="composer"]';
  const outgoingSelector = '.message--isOut';
  const editorFor = composer => composer?.querySelector('[contenteditable]:not([contenteditable="false"]), textarea, [role="textbox"]');
  const hasDraft = editor => !!editor && (typeof editor.value === 'string' ? editor.value.trim().length > 0 : editor.textContent.trim().length > 0);
  function scopeFor(composer) {
    for (let node = composer?.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.querySelector('.message')) return node;
    }
    return document.body;
  }
  function arm(composer) {
    if (!composer) return;
    followUntil = 0;
    const scope = scopeFor(composer);
    const known = new WeakSet(scope.querySelectorAll(outgoingSelector));
    intent = { composer, editor: editorFor(composer), hadDraft: hasDraft(editorFor(composer)), known, path: location.pathname, expires: Date.now() + 15000 };
  }
  function revealSentMessage() {
    if (Date.now() > followUntil || location.pathname !== followPath || document.visibilityState === 'hidden') return;
    const composer = document.querySelector(composerSelector);
    const latest = [...scopeFor(composer).querySelectorAll(outgoingSelector)].at(-1);
    if (!composer || !latest?.getClientRects().length) return;
    let scroller = latest.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1 && /auto|scroll|hidden|overlay/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    if (!scroller) { latest.scrollIntoView({ block: 'end', behavior: 'instant' }); return; }
    // MAX's floating composer overlaps the history viewport. Reserve actual
    // scrollable space, so aligning the final bubble cannot leave it underneath.
    const overlap = Math.max(0, scroller.getBoundingClientRect().bottom - composer.getBoundingClientRect().top + 12);
    let spacer = bottomSpacers.get(scroller);
    if (overlap > 0) {
      if (!spacer) {
        spacer = document.createElement('div'); spacer.setAttribute('aria-hidden', 'true');
        spacer.dataset.maxwebScrollSpacer = ''; bottomSpacers.set(scroller, spacer);
      }
      if (spacer.parentElement !== scroller) scroller.append(spacer);
      const height = `${Math.ceil(overlap)}px`;
      if (spacer.style.height !== height) {
        spacer.style.cssText = `height:${height};min-height:${height};flex:0 0 ${height};pointer-events:none;overflow-anchor:none`;
      }
    } else if (spacer?.isConnected) spacer.remove();
    latest.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const bottom = Math.min(scroller.getBoundingClientRect().bottom, composer.getBoundingClientRect().top) - 12;
    const covered = latest.getBoundingClientRect().bottom - bottom;
    if (covered > 0) scroller.scrollTop += covered;
  }
  function scheduleReveal() {
    if (followFrame || Date.now() > followUntil) return;
    followFrame = requestAnimationFrame(() => { followFrame = 0; revealSentMessage(); });
  }
  function jumpToLatest() {
    if (Date.now() > followUntil || location.pathname !== followPath || document.visibilityState === 'hidden') return;
    const composer = document.querySelector(composerSelector);
    const scope = scopeFor(composer);
    const bottom = [...scope.querySelectorAll('button.scrollButton, .scrollButtonContainer button')].find(button => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`;
      return !button.disabled && button.getClientRects().length && /вниз|концу (?:чата|истории)|последним сообщениям|bottom|latest messages|scroll down/i.test(label) && !/упомин|реакци|mention|reaction/i.test(label);
    });
    if (bottom) bottom.click();
    revealSentMessage(); scheduleReveal();
  }
  function accepted() {
    followPath = intent.path;
    intent = null;
    followUntil = Date.now() + 4000;
    for (const delay of [0, 120, 350, 800, 1500, 3000]) setTimeout(jumpToLatest, delay);
  }
  function inspect() {
    if (!intent) { if (Date.now() < followUntil) scheduleReveal(); return; }
    if (Date.now() > intent.expires || location.pathname !== intent.path || document.visibilityState === 'hidden') { intent = null; return; }
    const composer = intent.composer.isConnected ? intent.composer : document.querySelector(composerSelector);
    const editor = editorFor(composer);
    if (intent.hadDraft && editor && !hasDraft(editor)) { accepted(); return; }
    for (const message of scopeFor(composer).querySelectorAll(outgoingSelector)) {
      if (!intent.known.has(message)) { accepted(); return; }
    }
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const composer = event.target instanceof Element ? event.target.closest(composerSelector) : null;
    if (composer && hasDraft(editorFor(composer))) { arm(composer); queueMicrotask(inspect); }
  }, true);
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('button, [role="button"]') : null;
    if (!button || button.disabled) return;
    const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`;
    if (!/(?:отправить|\bsend\b)/i.test(label)) return;
    const composer = button.closest(composerSelector) || document.querySelector(composerSelector);
    if (composer) { arm(composer); queueMicrotask(inspect); }
  }, true);
  for (const type of ['wheel', 'touchmove']) document.addEventListener(type, () => { intent = null; followUntil = 0; }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { intent = null; followUntil = 0; } });
  function observe() {
    const composer = document.querySelector(composerSelector);
    if (composer) new ResizeObserver(scheduleReveal).observe(composer);
    new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) observe(); else document.addEventListener('DOMContentLoaded', observe, { once: true });
}


if (location.origin === 'https://web.telegram.org') {
  contextBridge.exposeInMainWorld('__maxwebProfile', {
    send: profile => ipcRenderer.send('account:profile', profile)
  });
  contextBridge.executeInMainWorld({ func: () => {
    let busy = false, lastProfile = '', avatarKey = '', avatar = '';
    const bounded = async operation => {
      let timer;
      try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Profile timeout')), 6000); })]); }
      finally { clearTimeout(timer); }
    };
    function publish(name, image) {
      const profile = JSON.stringify({ name, avatar: image });
      if (profile !== lastProfile) { lastProfile = profile; window.__maxwebProfile.send({ name, avatar: image }); }
    }
    async function syncTelegramProfile() {
      if (busy) return;
      busy = true;
      try {
        const root = window.rootScope;
        const managers = root?.managers;
        if (!root?.myId || !managers?.appUsersManager) return;
        // getSelf reads the signed-in user's record, not the contact list.
        const user = await bounded(managers.appUsersManager.getSelf());
        if (!user || String(user.id) !== String(root.myId)) return;
        const name = [user.first_name, user.last_name].filter(value => typeof value === 'string' && value.trim()).join(' ').trim().slice(0, 40);
        if (!name || /[\x00-\x1f\x7f]/.test(name)) return;
        const key = `${user.id}:${user.photo?.photo_id || ''}`;
        if (key !== avatarKey) {
          avatar = '';
          publish(name, '');
          if (user.photo?._ === 'userProfilePhoto') {
            const url = await bounded(managers.appAvatarsManager.loadAvatar(root.myId, user.photo, 'photo_small'));
            // Web K returns a local object URL for the downloaded own avatar.
            if (typeof url === 'string' && url.startsWith('blob:')) {
              const response = await fetch(url);
              const blob = await response.blob();
              if (blob.size <= 2 * 1024 * 1024) {
                const bitmap = await createImageBitmap(blob);
                try {
                  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
                  const edge = Math.min(bitmap.width, bitmap.height);
                  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, 64, 64);
                  avatar = canvas.toDataURL('image/png');
                } finally { bitmap.close(); }
              }
            }
          }
          avatarKey = key;
        }
        // A Telegram account switch during an asynchronous photo load must not
        // attach the previous identity to the newly selected account.
        if (String(root.myId) !== String(user.id)) return;
        publish(name, avatar);
      } catch { /* Keep the last known profile if Telegram changes its internals. */ }
      finally { busy = false; }
    }
    void syncTelegramProfile(); setInterval(syncTelegramProfile, 5000);
  } });
}

if (location.origin === 'https://web.whatsapp.com') {
  contextBridge.exposeInMainWorld('__maxwebProfile', {
    send: profile => ipcRenderer.send('account:profile', profile)
  });
  contextBridge.executeInMainWorld({ func: () => {
    let busy = false, lastProfile = '', imageKey = '', image = '', retryAt = 0;
    const module = name => { try { return typeof window.require === 'function' ? window.require(name) : null; } catch { return null; } };
    const ownID = () => {
      const prefs = module('WAWebUserPrefsMeUser');
      return prefs?.getMaybeMePnUser?.() || prefs?.getMaybeMeLidUser?.();
    };
    const identity = value => value?._serialized || value?.toString?.();
    function publish(name, avatar) {
      const profile = JSON.stringify({ name, avatar });
      if (profile !== lastProfile) { lastProfile = profile; window.__maxwebProfile.send({ name, avatar }); }
    }
    async function thumbnail(source) {
      const url = new URL(source);
      const local = url.protocol === 'blob:' && url.origin === location.origin;
      const remote = url.protocol === 'https:' && !url.username && !url.password && /(^|\.)(whatsapp\.net|whatsapp\.com|fbcdn\.net)$/.test(url.hostname);
      if (!local && !remote) throw new Error('Unexpected avatar origin');
      const response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(8000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('Avatar unavailable');
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Avatar too large'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bitmap = await createImageBitmap(new Blob(chunks));
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const edge = Math.min(bitmap.width, bitmap.height);
        canvas.getContext('2d').drawImage(bitmap, (bitmap.width-edge)/2, (bitmap.height-edge)/2, edge, edge, 0, 0, 64, 64);
        return canvas.toDataURL('image/png');
      } finally { bitmap.close(); }
    }
    async function syncWhatsAppProfile() {
      if (busy) return;
      busy = true;
      try {
        // Only the current user's identity, display name and own picture are read.
        // Do not enumerate contacts/messages or read credentials from storage.
        const me = ownID(); if (!me) return;
        const userID = identity(me);
        const name = (module('WAWebUserPrefsGeneral')?.getPushname?.() || module('WAWebConnModel')?.Conn?.pushname || '').trim().slice(0,40);
        if (!name || /[\x00-\x1f\x7f]/.test(name)) return;
        if (imageKey && !imageKey.startsWith(`${userID}:`)) { image = ''; imageKey = ''; retryAt = 0; }
        publish(name, image);
        const store = module('WAWebProfilePicThumbCollection')?.ProfilePicThumb || module('WAWebCollections')?.ProfilePicThumb;
        let ownPhoto = store?.get?.(me);
        if (!ownPhoto && store?.find) {
          let timer;
          try { ownPhoto = await Promise.race([store.find(me), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Own photo timeout')), 6000); })]); }
          finally { clearTimeout(timer); }
        }
        if (!ownPhoto) return;
        const getters = module('WAWebProfilePicThumbGetters');
        const sources = [getters?.getImg?.(ownPhoto), ownPhoto.img, getters?.getImgFull?.(ownPhoto), ownPhoto.imgFull];
        const source = sources.find(value => typeof value === 'string' && value) || (sources.includes(null) ? null : undefined);
        if (typeof source === 'string' && source) {
          const key = `${userID}:${source}`;
          if (key !== imageKey && Date.now() >= retryAt) {
            retryAt = Date.now() + 60000;
            const next = await thumbnail(source);
            if (identity(ownID()) !== userID) return;
            image = next; imageKey = key; retryAt = 0;
          }
        } else if (source === null && !ownPhoto.stale) { image = ''; imageKey = `${userID}:`; }
        if (identity(ownID()) === userID) publish(name, image);
      } catch { /* Preserve the last known own profile if WhatsApp changes its internals. */ }
      finally { busy = false; }
    }
    void syncWhatsAppProfile(); setInterval(syncWhatsAppProfile, 5000);
  } });
}
