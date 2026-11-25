'use strict';
const SERVICES = Object.freeze({
  max: Object.freeze({ name: 'MAX', url: 'https://web.max.ru/' }),
  telegram: Object.freeze({ name: 'Telegram', url: 'https://web.telegram.org/k/' }),
  whatsapp: Object.freeze({ name: 'WhatsApp', url: 'https://web.whatsapp.com/' }),
  vk: Object.freeze({ name: 'VK Мессенджер', url: 'https://web.vk.me/' })
});
function serviceInfo(service = 'max') {
  if (!Object.hasOwn(SERVICES, service)) throw new Error('Выберите MAX, Telegram, WhatsApp или VK.');
  return SERVICES[service];
}
module.exports = { SERVICES, serviceInfo };
