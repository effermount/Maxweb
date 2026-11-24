'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if (location.origin === 'https://web.max.ru') {
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
  // MAX stores its own profile under viewer['']. Read only that record;
  // do not scan contacts, messages, cookies or authentication records.
  let readingProfile = false, lastProfileName = '';
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
        const names = record?.model?.contact?.names;
        const own = names?.find(name => name.type === 'ONEME') || names?.[0];
        const name = [own?.firstName, own?.lastName].filter(value => typeof value === 'string' && value.trim()).join(' ').trim().slice(0, 40);
        if (name && name !== lastProfileName && !/[\x00-\x1f\x7f]/.test(name)) { lastProfileName = name; ipcRenderer.send('account:profile', name); }
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
  const composerSelector = '[data-testid="composer"]';
  const outgoingSelector = '.message--isOut';
  const editorFor = composer => composer?.querySelector('[contenteditable]:not([contenteditable="false"]), textarea, [role="textbox"]');
  const hasDraft = editor => !!editor && (typeof editor.value === 'string' ? editor.value.trim().length > 0 : editor.textContent.trim().length > 0);
  function scopeFor(composer) {
    for (let node = composer?.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.querySelector('button.scrollButton') || node.querySelector(outgoingSelector)) return node;
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
  function jumpToLatest() {
    if (Date.now() > followUntil || location.pathname !== followPath || document.visibilityState === 'hidden') return;
    const composer = document.querySelector(composerSelector);
    const scope = scopeFor(composer);
    const bottom = [...scope.querySelectorAll('button.scrollButton')].find(button => !button.disabled && button.getClientRects().length);
    if (bottom) {
      // MAX's own jump handles its virtualized history and loading the newest page.
      bottom.click();
      return;
    }
    const latest = [...scope.querySelectorAll(outgoingSelector)].at(-1);
    if (latest?.getClientRects().length) latest.scrollIntoView({ block: 'end', behavior: 'instant' });
  }
  function accepted() {
    followPath = intent.path;
    intent = null;
    followUntil = Date.now() + 1600;
    for (const delay of [0, 120, 350, 800, 1500]) setTimeout(jumpToLatest, delay);
  }
  function inspect() {
    if (!intent) return;
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
    new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) observe(); else document.addEventListener('DOMContentLoaded', observe, { once: true });
}
