'use strict';
const SERVICES = Object.freeze({
  max: Object.freeze({ name: 'MAX', url: 'https://web.max.ru/' }),
  telegram: Object.freeze({ name: 'Telegram', url: 'https://web.telegram.org/k/' }),
  whatsapp: Object.freeze({ name: 'WhatsApp', url: 'https://web.whatsapp.com/' })
});
function serviceInfo(service = 'max') {
  if (!Object.hasOwn(SERVICES, service)) throw new Error('Выберите MAX, Telegram или WhatsApp.');
  return SERVICES[service];
}
module.exports = { SERVICES, serviceInfo };
