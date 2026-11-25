'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releaseNotes } = require('../scripts/release-notes.cjs');

test('update description contains only the requested version without its duplicate title', () => {
  const history = '# Maxweb 1.2.5\n\n- Current change\n\n### Details\nMore details\n\n## Maxweb 1.2.4\n\n- Older change\n';
  assert.equal(releaseNotes(history, '1.2.5'), '- Current change\n\n### Details\nMore details');
  assert.equal(releaseNotes(history, '1.2.4'), '- Older change');
});
test('release notes support Windows newlines and fail closed for absent or empty versions', () => {
  assert.equal(releaseNotes('# Maxweb v1.2.5\r\n\r\n- Change\r\n', '1.2.5'), '- Change');
  assert.throws(() => releaseNotes('# Maxweb 1.2.4\n- Old', '1.2.5'), /Нет описания/);
  assert.throws(() => releaseNotes('# Maxweb 1.2.5\n\n## Maxweb 1.2.4\n- Old', '1.2.5'), /Пустое описание/);
});
test('rebranded release notes exclude the previous Maxweb history', () => {
  const notes = '# Обла 1.2.14\n\n- New brand\n\n## Maxweb 1.2.13\n\n- Universal\n';
  assert.equal(releaseNotes(notes, '1.2.14'), '- New brand');
  assert.equal(releaseNotes(notes, '1.2.13'), '- Universal');
});
