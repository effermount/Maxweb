'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTouchIDPrompt } = require('../src/touch-id.cjs');

test('packaged Touch ID uses the named native component and accepts only successful completion', async () => {
  let complete;
  const prompt = createTouchIDPrompt({ packaged: true, resourcesPath: '/App/Contents/Resources', run(file, args, options, callback) {
    assert.equal(file, '/App/Contents/Frameworks/Обла.app/Contents/MacOS/Обла');
    assert.deepEqual(args, ['--authenticate']); assert.equal(options.timeout, 90000); complete = callback;
  } });
  let unlocked = false;
  const pending = prompt().then(() => { unlocked = true; });
  await Promise.resolve(); assert.equal(unlocked, false);
  complete(null); await pending; assert.equal(unlocked, true);
  const cancelled = prompt(); complete(new Error('cancelled'));
  await assert.rejects(cancelled, /Touch ID отменён/);
});
test('development keeps the Electron prompt', async () => {
  let called = false;
  await createTouchIDPrompt({ packaged: false, fallback: async () => { called = true; } })();
  assert.equal(called, true);
});
