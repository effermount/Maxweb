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
const isWhatsAppURL = value => isServiceURL(value, 'whatsapp');
const isVKURL = value => isServiceURL(value, 'vk');
const VK_AUTH_ORIGINS = new Set(['https://id.vk.ru', 'https://id.vk.com', 'https://login.vk.ru', 'https://login.vk.com', 'https://oauth.vk.ru', 'https://oauth.vk.com']);
function isServiceAuthURL(value, service) {
  try { const url = new URL(value); return service === 'vk' && !url.username && !url.password && VK_AUTH_ORIGINS.has(url.origin); }
  catch { return false; }
}
const isServiceNavigationURL = (value, service = 'max') => isServiceURL(value, service) || isServiceAuthURL(value, service);

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

module.exports = { MAX_URL, isMaxURL, isTelegramURL, isWhatsAppURL, isVKURL, isServiceAuthURL, isServiceNavigationURL, isServiceURL, isExternalURL, mayUsePermission, unreadBadge };
