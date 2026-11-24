'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-runtime-'));
try {
  for (const script of ['runtime.cjs', 'restart.cjs', 'scroll-runtime.cjs']) {
    const result = spawnSync(require('electron'), [path.join(__dirname, '../tests', script)], {
      stdio: 'inherit', env: { ...process.env, MAXWEB_TEST_PROFILE: profile }
    });
    if (result.status !== 0) { process.exitCode = result.status || 1; break; }
  }
} finally { fs.rmSync(profile, { recursive: true, force: true }); }

if (!process.exitCode) {
  const featureProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'maxweb-features-'));
  try {
    for (const script of ['features-runtime.cjs', 'features-restart.cjs']) {
      const result = spawnSync(require('electron'), [path.join(__dirname, '../tests', script)], {
        stdio: 'inherit', env: { ...process.env, MAXWEB_FEATURE_PROFILE: featureProfile }
      });
      if (result.status !== 0) { process.exitCode = result.status || 1; break; }
    }
  } finally { fs.rmSync(featureProfile, { recursive: true, force: true }); }
}
