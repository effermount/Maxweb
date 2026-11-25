'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const profileStatus = (stage, detail) => ipcRenderer.send('account:profile-status', { stage, ...detail });
function profileFailure(stage, name, message) {
  const text = String(message || '');
  const code = /HTTP (\d{3})/.exec(text)?.[1];
  profileStatus(stage, { errorName: String(name || 'Error').replace(/[^A-Za-z]/g, '').slice(0, 40),
    errorCode: code ? `http-${code}` : /origin/i.test(text) ? 'origin' : /taint|cross-origin|insecure/i.test(text) ? 'canvas-security' : /large|dimensions/i.test(text) ? 'dimensions' : /decode|ImageBitmap/i.test(text) ? 'decode' : /fetch|network|connection/i.test(text) ? 'network' : /timeout/i.test(text) ? 'timeout' : 'unknown' });
}
function localProfileAvatar(source) {
  // img-src can allow local avatars while connect-src rejects fetch(blob:).
  const url = new URL(source);
  if (url.protocol !== 'blob:' || url.origin !== location.origin) throw new Error('Unexpected own avatar origin');
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.src = ''; reject(new Error('Avatar timeout')); }, 8000);
    image.onerror = () => { clearTimeout(timer); reject(new Error('Avatar unavailable')); };
    image.onload = () => {
      clearTimeout(timer);
      try {
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('Invalid avatar dimensions');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const edge = Math.min(image.naturalWidth, image.naturalHeight);
        canvas.getContext('2d').drawImage(image, (image.naturalWidth-edge)/2, (image.naturalHeight-edge)/2, edge, edge, 0, 0, 64, 64);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) { reject(error); }
    };
    image.src = url.href;
  });
}
if (['https://web.max.ru', 'https://web.telegram.org', 'https://web.whatsapp.com', 'https://web.vk.me'].includes(location.origin)) {
  if (location.origin !== 'https://web.max.ru') contextBridge.exposeInMainWorld('__maxwebProfile', {
    send: profile => ipcRenderer.send('account:profile', profile),
    localAvatar: source => localProfileAvatar(source),
    status: (stage, detail) => profileStatus(stage, detail),
    failure: (stage, name, message) => profileFailure(stage, name, message),
    readAvatar: source => ipcRenderer.invoke('account:avatar', source)
  });
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
    if (baseURL === lastAvatarURL && (avatar || Date.now() < avatarRetryAt)) return avatar || undefined;
    if (baseURL !== lastAvatarURL) avatar = '';
    lastAvatarURL = baseURL; avatarRetryAt = Date.now() + 60000;
    try {
      const url = new URL(baseURL);
      if (url.protocol !== 'https:' || url.username || url.password) return undefined;
      url.searchParams.append('fn', 'sqr_128');
      const response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(8000) })
        .catch(async () => new Response(await ipcRenderer.invoke('account:avatar', url.href)));
      if (!response.ok || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) return undefined;
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); return undefined; }
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
    } catch (error) { profileFailure('max-error', error.name, error.message); return undefined; }
  }
  async function ownRecords(db, storeName, id) {
    const read = key => new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    if (!Array.isArray(store.keyPath) || store.keyPath[0] !== 'revision') return [await read(id)].filter(Boolean);
    // MAX 26+ uses [schemaRevision, id]. Discover only revision prefixes by
    // skipping whole key ranges, then request the exact owner key per revision.
    // No other contact values are loaded and no contact list is traversed.
    const revisions = await new Promise((resolve, reject) => {
      const values = [], request = store.openKeyCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || values.length >= 16) { resolve(values); return; }
        if (!Array.isArray(cursor.key) || typeof cursor.key[0] !== 'string') { resolve(values); return; }
        const revision = cursor.key[0]; values.push(revision);
        try { cursor.continue([revision, []]); } catch (error) { reject(error); }
      };
    });
    return (await Promise.all(revisions.map(revision => read([revision, id])))).filter(Boolean)
      .sort((a, b) => Number(b.model?._meta?.persistTime || 0) - Number(a.model?._meta?.persistTime || 0));
  }
  async function syncProfile() {
    if (readingProfile) return;
    readingProfile = true;
    try {
      const allDatabases = await indexedDB.databases();
      const candidates = allDatabases.filter(db => /^max-db-\d+-\d+$/.test(db.name || ''));
      const signedIn = candidates.filter(db => !db.name.endsWith('-0'));
      const databases = signedIn.length ? signedIn : candidates;
      const identities = new Set(databases.map(db => db.name.split('-').at(-1)));
      profileStatus('max-db', { count: databases.length, identityCount: identities.size, hasZeroIdentity: identities.has('0'), fields: [...new Set(allDatabases.map(db => (db.name || '').replace(/\d+/g, 'N')))] });
      if (identities.size !== 1) return;
      for (const newest of databases.sort((a, b) => Number(b.name.split('-')[2]) - Number(a.name.split('-')[2]))) {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(newest.name);
        request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Missing MAX database')); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        if (!db.objectStoreNames.contains('viewer')) continue;
        const record = (await ownRecords(db, 'viewer', '')).find(value => value?.model?.contact);
        let contact = record?.model?.contact;
        profileStatus('max-record', { recordFound: !!contact, hasSource: !!contact?.baseUrl, hasRawSource: !!contact?.baseRawUrl, fields: Object.keys(contact || {}) });
        // MAX renders its viewer through the own contact record, which can be
        // newer than the copy embedded in viewer (especially the photo URL).
        const ownID = contact?.id?.toString();
        if (/^\d+$/.test(ownID || '') && db.objectStoreNames.contains('contacts')) {
          const saved = (await ownRecords(db, 'contacts', ownID)).find(value => value?.model?.id?.toString() === ownID);
          if (saved?.model?.id?.toString() === ownID && Number(saved.model.updateTime || 0) >= Number(contact.updateTime || 0)) contact = { ...contact, ...saved.model };
        }
        const names = contact?.names;
        const own = names?.find(name => name.type === 'ONEME') || names?.[0];
        const name = ([own?.firstName, own?.lastName].filter(value => typeof value === 'string' && value.trim()).join(' ') || (typeof own?.name === 'string' ? own.name : '')).trim().slice(0, 40);
        if (!name || /[\x00-\x1f\x7f]/.test(name)) continue;
        const image = await profileAvatar(typeof contact.baseUrl === 'string' ? contact.baseUrl : '');
        profileStatus('max-source', { hasName: !!name, hasSource: !!contact.baseUrl, sourceType: typeof contact.baseUrl, imageLoaded: !!image });
        const profile = JSON.stringify({ name, avatar: image });
        if (profile !== lastProfile) { lastProfile = profile; ipcRenderer.send('account:profile', { name, avatar: image }); }
        break;
      } finally { db.close(); }
      }
    } catch (error) { profileFailure('max-error', error.name, error.message); }
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
  contextBridge.executeInMainWorld({ func: () => {
    let busy = false, lastProfile = '', avatarKey = '', avatar = '';
    const roots = new Map();
    const bounded = async operation => {
      let timer;
      try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Profile timeout')), 6000); })]); }
      finally { clearTimeout(timer); }
    };
    function publish(name, image) {
      const profile = JSON.stringify({ name, avatar: image });
      if (profile !== lastProfile) { lastProfile = profile; window.__maxwebProfile.send({ name, avatar: image }); }
    }
    async function telegramRoot() {
      if (window.rootScope?.myId) return window.rootScope;
      // Cached Web K can execute a different module revision from the HTML's
      // modulepreload hints. Reuse only resources this page actually loaded.
      const sources = [...new Set(performance.getEntriesByType('resource').map(entry => entry.name))].filter(source => {
        try { const url = new URL(source); return url.origin === location.origin && !url.search && !url.hash && /\/rootScope-[A-Za-z0-9_-]+\.js$/.test(url.pathname); } catch { return false; }
      });
      for (const source of sources.slice(-4)) {
        if (!roots.has(source)) roots.set(source, bounded(import(source)).catch(() => undefined));
        const loaded = await roots.get(source);
        const root = loaded && Object.values(loaded).find(value => value && typeof value.getMyId === 'function' && /^[1-9]\d*$/.test(String(value.getMyId())));
        if (root) return root;
      }
    }
    async function syncTelegramProfile() {
      if (busy) return;
      busy = true;
      try {
        const root = await telegramRoot();
        const proxy = window.apiManagerProxy;
        const accountNumber = proxy?.tabState?.accountNumber;
        const useProxy = !root?.myId && typeof proxy?.invoke === 'function' && Number.isInteger(accountNumber) && accountNumber >= 0 && accountNumber <= 4;
        const getSelf = useProxy ? () => proxy.invoke('manager', { name: 'appUsersManager', method: 'getSelf', args: [], accountNumber }) : () => root.managers.appUsersManager.getSelf();
        const loadAvatar = useProxy ? (id, photo, size) => proxy.loadAvatar(id, photo, size, accountNumber) : (id, photo, size) => root.managers.appAvatarsManager.loadAvatar(id, photo, size);
        const managers = root?.managers;
        window.__maxwebProfile.status('tg-root', { hasRoot: !!root, hasId: !!root?.myId, hasUserManager: !!managers?.appUsersManager, hasLoader: !!window.apiManagerProxy, hasGetters: useProxy, count: roots.size, fields: [...roots.keys()].map(source => new URL(source).pathname.split('/').pop().replace(/\.js$/, '')) });
        if (!useProxy && !managers?.appUsersManager) return;
        // getSelf reads the signed-in user's record, not the contact list.
        const user = await bounded(getSelf());
        window.__maxwebProfile.status('tg-model', { fields: Object.keys(user || {}), hasId: !!user?.id, sourceType: typeof user?.id, hasName: !!(user?.first_name || user?.last_name), photoKind: user?.photo?._ || 'none' });
        if (!user || !/^[1-9]\d*$/.test(String(user.id)) || !useProxy && root?.myId && String(user.id) !== String(root.myId)) return;
        const peerID = (!useProxy && root?.myId) || (typeof user.id.toPeerId === 'function' ? user.id.toPeerId() : user.id);
        const stillOwn = async () => (!useProxy || proxy.tabState.accountNumber === accountNumber) && String((await bounded(getSelf()))?.id) === String(user.id);
        const name = [user.first_name, user.last_name].filter(value => typeof value === 'string' && value.trim()).join(' ').trim().slice(0, 40);
        if (!name || /[\x00-\x1f\x7f]/.test(name)) return;
        const key = `${user.id}:${user.photo?.photo_id || ''}`;
        window.__maxwebProfile.status('tg-source', { photoKind: user.photo?._ || 'none', hasLoader: useProxy || typeof managers?.appAvatarsManager?.loadAvatar === 'function' });
        if (key !== avatarKey) {
          publish(name, undefined);
          let nextAvatar = '';
          if (user.photo?._ === 'userProfilePhoto') {
            let url;
            try { url = await bounded(loadAvatar(peerID, user.photo, 'photo_small')); } catch {}
            window.__maxwebProfile.status('tg-url', { sourceType: typeof url, hasSource: !!url, sourceProtocol: typeof url === 'string' && url.startsWith('blob:') ? 'blob' : 'other' });
            if (!url) url = document.querySelector(`[data-peer-id="${user.id}"] img.avatar-photo`)?.src;
            if (typeof url === 'string' && url.startsWith('blob:')) nextAvatar = await window.__maxwebProfile.localAvatar(url);
            // A missing URL or a temporary decode/download failure must be retried.
            if (!nextAvatar) return;
          }
          if (!await stillOwn()) return;
          avatar = nextAvatar;
          avatarKey = key;
        }
        // A Telegram account switch during an asynchronous photo load must not
        // attach the previous identity to the newly selected account.
        if (!await stillOwn()) return;
        publish(name, avatar);
      } catch (error) { window.__maxwebProfile.failure('tg-error', error.name, error.message); }
      finally { busy = false; }
    }
    void syncTelegramProfile(); setInterval(syncTelegramProfile, 5000);
  } });
}

if (location.origin === 'https://web.whatsapp.com') {
  contextBridge.executeInMainWorld({ func: () => {
    let busy = false, lastProfile = '', imageKey = '', image = '', retryAt = 0, lookupRetryAt = 0, pictureOwner = '';
    const module = name => { try { return typeof window.require === 'function' ? window.require(name) : null; } catch { return null; } };
    const ownID = () => {
      const prefs = module('WAWebUserPrefsMeUser');
      return prefs?.getMaybeMeUser?.() || prefs?.getMaybeMePnUser?.() || prefs?.getMaybeMeLidUser?.();
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
      if (local) return window.__maxwebProfile.localAvatar(url.href);
      const response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(8000) })
        .catch(async error => { if (local) throw error; return new Response(await window.__maxwebProfile.readAvatar(url.href)); });
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
        if (pictureOwner !== userID) { lookupRetryAt = 0; pictureOwner = userID; }
        const name = (module('WAWebUserPrefsGeneral')?.getPushname?.() || module('WAWebConnModel')?.Conn?.pushname || '').trim().slice(0,40);
        if (!name || /[\x00-\x1f\x7f]/.test(name)) return;
        if (imageKey && !imageKey.startsWith(`${userID}:`)) { image = ''; imageKey = ''; retryAt = 0; }
        publish(name, image || undefined);
        const pictures = module('WAWebProfilePicThumbCollection');
        const store = pictures?.ProfilePicThumbCollection || pictures?.ProfilePicThumbCollectionImpl || pictures?.ProfilePicThumb || module('WAWebCollections')?.ProfilePicThumb;
        window.__maxwebProfile.status('wa-store', { hasStore: !!store, hasLoader: typeof store?.find === 'function' });
        const findPicture = async owner => {
          if (!store?.find) return store?.get?.(owner);
          let timer;
          try { return await Promise.race([store.find(owner), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Own photo timeout')), 6000); })]); }
          finally { clearTimeout(timer); }
        };
        const getters = module('WAWebProfilePicThumbGetters');
        const pictureSource = photo => {
          if (!photo) return;
          const field = key => { try { return photo[key] ?? photo.get?.(key) ?? photo[`__x_${key}`] ?? photo.mirror?.[key]; } catch { return undefined; } };
          const getter = name => { try { return getters?.[name]?.(photo); } catch { return undefined; } };
          const values = [getter('getImg'), field('img'), getter('getImgFull'), field('imgFull'), field('previewEurl'), field('eurl')];
          return values.find(value => typeof value === 'string' && value) || (values.includes(null) ? null : undefined);
        };
        let ownPhoto = await findPicture(me), source = pictureSource(ownPhoto);
        // WhatsApp can keep an empty thumbnail for the user's LID while its PN
        // alias has the picture. Both IDs come exclusively from own user prefs.
        const prefs = module('WAWebUserPrefsMeUser');
        const owners = [prefs?.getMaybeMePnUser?.(), prefs?.getMaybeMeLidUser?.()].filter(Boolean);
        const seen = new Set([userID]);
        for (const owner of owners) {
          if (typeof source === 'string' && source) break;
          const id = identity(owner); if (seen.has(id)) continue; seen.add(id);
          const candidate = await findPicture(owner), next = pictureSource(candidate);
          if (typeof next === 'string' && next) { ownPhoto = candidate; source = next; }
        }
        if (source === undefined && ownPhoto?.markStale && Date.now() >= lookupRetryAt) {
          lookupRetryAt = Date.now() + 60000;
          ownPhoto.markStale(); ownPhoto = await findPicture(me); source = pictureSource(ownPhoto);
        }
        if (!ownPhoto) return;
        window.__maxwebProfile.status('wa-model', { fields: Object.keys(ownPhoto), photoKind: typeof ownPhoto.previewEurl });
        window.__maxwebProfile.status('wa-source', { hasSource: !!source, sourceType: typeof source, hasGetters: !!getters, stale: !!ownPhoto.stale, sourceProtocol: typeof source === 'string' && source.startsWith('blob:') ? 'blob' : 'other' });
        if (typeof source === 'string' && source) {
          const key = `${userID}:${source}`;
          if (key !== imageKey && Date.now() >= retryAt) {
            retryAt = Date.now() + 60000;
            const next = await thumbnail(source);
            if (identity(ownID()) !== userID) return;
            image = next; imageKey = key; retryAt = 0;
          }
        } else if (source === null && !ownPhoto.stale && !ownPhoto.eurlStale) { image = ''; imageKey = `${userID}:`; }
        if (identity(ownID()) === userID) publish(name, imageKey ? image : undefined);
      } catch (error) { window.__maxwebProfile.failure('wa-error', error.name, error.message); }
      finally { busy = false; }
    }
    void syncWhatsAppProfile(); setInterval(syncWhatsAppProfile, 5000);
  } });
}

if (location.origin === 'https://web.vk.me') {
  contextBridge.executeInMainWorld({ func: () => {
    let busy = false, lastProfile = '', imageSource = '', image = '', lastOwner = '';
    function publish(name, avatar = imageSource ? image : undefined) { const profile=JSON.stringify({name,avatar});if(profile!==lastProfile){lastProfile=profile;window.__maxwebProfile.send({name,avatar});} }
    const selfLabels = ['Мой профиль', 'Моя страница', 'Мой аккаунт', 'My profile', 'Your profile', 'My account'];
    const cleanName = value => typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value) ? value.trim().slice(0, 40) : '';
    const ownID = () => {
      const id = String(window.vkmeConfig?.vkid || window.vk?.id || '');
      return /^[1-9]\d*$/.test(id) ? id : '';
    };
    function selfRecord(value, id, depth = 0) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      let fallback;
      if (id && String(value.id ?? value.user_id ?? '') === id) {
        window.__maxwebProfile.status('vk-model', { fields: Object.keys(value).concat(value.photo && typeof value.photo === 'object' ? Object.keys(value.photo).map(key => `photo_${key}`) : []), photoKind: Array.isArray(value.photo) ? 'array' : typeof value.photo });
        const name = cleanName([value.first_name || value.firstName, value.last_name || value.lastName].filter(Boolean).join(' ') || value.fullName || value.name);
        if (name) {
          const photo = value.photo;
          const sizes = [photo?.photo100, photo?.photo200, photo?.photo50, photo?.url, photo?.src, photo?.small, photo?.medium, photo?.large, photo?.s, photo?.m, photo?.l, photo?.[100], photo?.[50], photo?.[200], ...(Array.isArray(photo?.sizes) ? photo.sizes.map(size => size?.url) : []), ...(Array.isArray(photo) ? photo.map(size => typeof size === 'string' ? size : size?.url) : [])];
          fallback = { name, source: value.has_photo === false || value.has_photo === 0 ? '' :
            [value.photo_100, value.photo_200, value.photo_50, value.photo100, value.photo200, value.photoUrl, value.avatarUrl, value.avatar, photo, ...sizes].find(url => typeof url === 'string' && url) };
          if (fallback.source !== undefined) return fallback;
        }
      }
      // Only named own-profile slots. Never walk collections, messages, auth
      // fields, a Redux store or arbitrary application state.
      if (depth < 2) for (const key of ['user', 'profile', 'viewer', 'self', 'currentUser', 'account', 'activeAccount', 'value', 'data']) {
        const result = selfRecord(value[key], id, depth + 1);
        if (result?.source !== undefined) return result;
        fallback ||= result;
      }
      return fallback;
    }
    function reactSelf(control, id) {
      if (!control || !id) return;
      const keys = Object.keys(control);
      const props = keys.find(key => key.startsWith('__reactProps$'));
      const direct = props && selfRecord(control[props], id); if (direct?.source !== undefined) return direct;
      let fallback = direct;
      let fiber = control[keys.find(key => key.startsWith('__reactFiber$'))];
      for (let n = 0; fiber && n < 24; n++, fiber = fiber.return) {
        const result = selfRecord(fiber.memoizedProps, id);
        if (result?.source !== undefined) return result;
        fallback ||= result;
        let hook = fiber.memoizedState;
        for (let m = 0; hook && m < 24; m++, hook = hook.next) {
          const result = selfRecord(hook.memoizedState, id);
          if (result?.source !== undefined) return result;
          fallback ||= result;
        }
      }
      return fallback;
    }
    function ownProfile() {
      const id = ownID();
      const menuButton = document.querySelector('button[aria-label="Меню"], button[title="Меню"], [role="button"][aria-label="Меню"]');
      let fallback;
      if (id) {
        const models = [selfRecord(window.vkmeConfig, id), selfRecord(window.vk, id), reactSelf(menuButton, id)];
        const model = models.find(value => value?.source !== undefined) || models.find(Boolean);
        if (model?.source !== undefined) return { ...model, id };
        if (model) fallback = { ...model, id };
      }
      const own = selfLabels.map(label => document.querySelector(`button[aria-label="${label}"], a[aria-label="${label}"]`)).find(Boolean);
      if (own) {
        const photo = own.querySelector('img');
        const name = cleanName(own.getAttribute('data-name') || photo?.alt);
        if (name && !selfLabels.includes(name) && !/^(аватар|фото|profile|avatar)/i.test(name)) return { name, source: photo?.currentSrc || photo?.src, id, control: own };
      }
      // Current VK Me exposes the signed-in account as the first header in its
      // own navigation menu, rather than a button labelled "Мой профиль".
      // Reading this menu also works when the profile model isn't in the button's
      // props yet. Do not open the menu or read names from the conversation area.
      const menu = id && menuButton && document.querySelector('[role="menu"][aria-label="Меню"]');
      if (menu) {
        let container = menu;
        for (let n = 0; container.children.length === 1 && n < 4; n++) container = container.firstElementChild;
        const header = container.firstElementChild;
        const model = reactSelf(header, id); if (model?.source !== undefined) return { ...model, id, control: header };
        const text = header?.textContent?.trim();
        const name = text && text.length <= 80 ? cleanName(text) : '';
        if (name && !/^(меню|контакты|настройки|помощь|выйти|архив|важные сообщения)$/i.test(name)) {
          const photo = header.querySelector('img');
          return { name, source: photo?.currentSrc || photo?.src, id, control: header };
        }
      }
      return fallback;
    }
    async function syncVKProfile() {
      if (busy) return;
      busy = true;
      try {
        const own = ownProfile();
        window.__maxwebProfile.status('vk-source', { hasName: !!own?.name, hasSource: !!own?.source, sourceType: typeof own?.source });
        if (!own) return;
        const { name, id } = own;
        if (lastOwner && id && id !== lastOwner) { image = ''; imageSource = ''; publish(name, ''); }
        lastOwner = id;
        publish(name);
        const source = own.source;
        if (source === undefined) return;
        if (source !== imageSource) {
          if (!source) { image = ''; imageSource = ''; }
          else {
            const url = new URL(source, location.href);
            const local = url.protocol === 'blob:' && url.origin === location.origin;
            const remote = url.protocol === 'https:' && !url.username && !url.password && /(^|\.)(vk\.me|vk\.ru|vk\.com|userapi\.com|vkuserphoto\.ru|vkuserphoto\.com)$/.test(url.hostname);
            if (!local && !remote) return;
            if (local) {
              image = await window.__maxwebProfile.localAvatar(url.href); imageSource = source;
              if (id && ownID() !== id || own.control && !own.control.isConnected) return;
              publish(name, image); return;
            }
            const response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(8000) })
              .catch(async error => { if (local) throw error; return new Response(await window.__maxwebProfile.readAvatar(url.href)); });
            if (!response.ok || Number(response.headers.get('content-length')) > 2*1024*1024) return;
            const reader=response.body.getReader(), chunks=[];let size=0;
            try { while(true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();return;}chunks.push(value); } }
            finally { reader.releaseLock(); }
            const bitmap=await createImageBitmap(new Blob(chunks));
            try {
              const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
              const edge=Math.min(bitmap.width,bitmap.height);
              canvas.getContext('2d').drawImage(bitmap,(bitmap.width-edge)/2,(bitmap.height-edge)/2,edge,edge,0,0,64,64);
              image=canvas.toDataURL('image/png');imageSource=source;
            } finally { bitmap.close(); }
          }
        }
        // The DOM may have changed while the avatar was loading.
        if (id && ownID() !== id || own.control && !own.control.isConnected) return;
        publish(name, image);
      } catch (error) { window.__maxwebProfile.failure('vk-error', error.name, error.message); }
      finally { busy=false; }
    }
    void syncVKProfile();setInterval(syncVKProfile,5000);
  } });
}
