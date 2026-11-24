'use strict';
const DEFAULT_BANNER = { showAccount: true, showSender: true, showText: true, sound: true };
function normalizeBanner(value) {
  return Object.fromEntries(Object.entries(DEFAULT_BANNER).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
}
function bannerContent(account, title, body, settings, locked = false) {
  const options = normalizeBanner(settings);
  // A body may include the sender in group chats. Hide it whenever sender is hidden.
  return { title: !locked && options.showSender ? String(title || 'MAX').slice(0, 200) : 'Maxweb',
    subtitle: !locked && options.showAccount ? account.name : '',
    body: !locked && options.showSender && options.showText ? String(body || 'Новое сообщение').slice(0, 2000) : 'Новое сообщение в MAX',
    silent: !options.sound };
}
module.exports = { DEFAULT_BANNER, normalizeBanner, bannerContent };
