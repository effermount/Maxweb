'use strict';
const { serviceInfo } = require('./services.cjs');
const MAX_URL = serviceInfo('max').url;

function isServiceURL(value, service = 'max') {
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.origin === new URL(serviceInfo(service).url).origin;
  } catch { return false; }
}
const isMaxURL = value => isServiceURL(value, 'max');
const isTelegramURL = value => isServiceURL(value, 'telegram');

function isExternalURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch { return false; }
}

function mayUsePermission(permission, requestingOrigin, topLevelURL, notifications = true, service = 'max') {
  if (!isServiceURL(requestingOrigin, service) || !isServiceURL(topLevelURL, service)) return false;
  if (permission === 'notifications') return notifications;
  return ['media', 'fullscreen', 'clipboard-sanitized-write', 'background-sync'].includes(permission);
}

function unreadBadge(title) {
  const match = title.match(/^\s*\((\d{1,6})\)/) || title.match(/^\s*(\d{1,6})\s+(?:непрочитанн(?:ый|ых) чат(?:а|ов)?|unread chats?)\s*$/i);
  if (!match || Number(match[1]) === 0) return '';
  return Number(match[1]) > 99 ? '99+' : String(Number(match[1]));
}

module.exports = { MAX_URL, isMaxURL, isTelegramURL, isServiceURL, isExternalURL, mayUsePermission, unreadBadge };
