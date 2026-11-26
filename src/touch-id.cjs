'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');

function createTouchIDPrompt({ packaged, resourcesPath, fallback, run = execFile }) {
  if (!packaged) return fallback;
  const executable = path.join(resourcesPath, '../Frameworks/Обла.app/Contents/MacOS/Обла');
  return () => new Promise((resolve, reject) => {
    run(executable, ['--authenticate'], { timeout: 90000, maxBuffer: 4096 }, error => {
      if (error) reject(new Error('Touch ID отменён или недоступен. Используйте код.'));
      else resolve();
    });
  });
}
module.exports = { createTouchIDPrompt };
