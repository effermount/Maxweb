'use strict';
const SERVICES = Object.freeze({
  max: Object.freeze({ name: 'MAX', url: 'https://web.max.ru/' }),
  telegram: Object.freeze({ name: 'Telegram', url: 'https://web.telegram.org/k/' })
});
function serviceInfo(service = 'max') {
  if (!Object.hasOwn(SERVICES, service)) throw new Error('Выберите MAX или Telegram.');
  return SERVICES[service];
}
module.exports = { SERVICES, serviceInfo };
