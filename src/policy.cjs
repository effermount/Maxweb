'use strict';
const MAX_URL = 'https://web.max.ru/';

function isMaxURL(value) {
  try { return new URL(value).origin === 'https://web.max.ru'; }
  catch { return false; }
}

function isExternalURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch { return false; }
}

function mayUsePermission(permission, requestingOrigin, topLevelURL, notifications = true) {
  if (!isMaxURL(requestingOrigin) || !isMaxURL(topLevelURL)) return false;
  if (permission === 'notifications') return notifications;
  return ['media', 'fullscreen', 'clipboard-sanitized-write', 'background-sync'].includes(permission);
}

function unreadBadge(title) {
  const match = title.match(/^\s*\((\d{1,6})\)/) || title.match(/^\s*(\d{1,6})\s+(?:непрочитанн(?:ый|ых) чат(?:а|ов)?|unread chats?)\s*$/i);
  if (!match || Number(match[1]) === 0) return '';
  return Number(match[1]) > 99 ? '99+' : String(Number(match[1]));
}

module.exports = { MAX_URL, isMaxURL, isExternalURL, mayUsePermission, unreadBadge };
