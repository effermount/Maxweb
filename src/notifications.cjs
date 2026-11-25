'use strict';
const { serviceInfo } = require('./services.cjs');
const { APP_NAME } = require('./brand.cjs');
const DEFAULT_BANNER = { showAccount: true, showSender: true, showText: true, sound: true };
function normalizeBanner(value) {
  return Object.fromEntries(Object.entries(DEFAULT_BANNER).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
}
function bannerContent(account, title, body, settings, locked = false) {
  const options = normalizeBanner(settings);
  const service = serviceInfo(account?.service).name;
  // A body may include the sender in group chats. Hide it whenever sender is hidden.
  return { title: !locked && options.showSender ? String(title || service).slice(0, 200) : APP_NAME,
    subtitle: !locked && options.showAccount ? account.name : '',
    body: !locked && options.showSender && options.showText ? String(body || `Новое сообщение в ${service}`).slice(0, 2000) : (locked ? 'Новое сообщение' : `Новое сообщение в ${service}`),
    silent: !options.sound };
}
module.exports = { DEFAULT_BANNER, normalizeBanner, bannerContent };
