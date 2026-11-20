'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Keep Chromium's real Notification implementation and all MAX click handlers.
// The only native message allowed here activates this sender's own account.
window.addEventListener('message', event => {
  if (event.source === window && event.origin === 'https://web.max.ru' && event.data?.type === 'maxweb:notification-click') ipcRenderer.send('account:notification-click');
});
contextBridge.executeInMainWorld({ func: () => {
  if (location.origin !== 'https://web.max.ru' || typeof window.Notification !== 'function') return;
  const NativeNotification = window.Notification;
  window.Notification = new Proxy(NativeNotification, {
    construct(target, args) {
      const notification = Reflect.construct(target, args);
      notification.addEventListener('click', () => window.postMessage({ type: 'maxweb:notification-click' }, location.origin));
      return notification;
    }
  });
} });

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
