'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync, createPrivateKey, createPublicKey } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const directory = path.join(root, '.release');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const privateFile = path.join(directory, 'signing-private.pem');
const publicFile = path.join(root, 'assets/release-public.pem');
if (!fs.existsSync(privateFile)) {
  if (!fs.existsSync(publicFile)) {
    const pair = generateKeyPairSync('ed25519');
    fs.writeFileSync(privateFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
}
if (fs.existsSync(privateFile)) {
  const privateKey = createPrivateKey(fs.readFileSync(privateFile));
  const publicPEM = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  if (fs.existsSync(publicFile) && fs.readFileSync(publicFile, 'utf8') !== publicPEM) throw new Error('Публичный и приватный ключи выпуска не совпадают.');
  fs.writeFileSync(publicFile, publicPEM);
}
if (process.argv.includes('--key-only')) process.exit(0);
if (process.argv.includes('--windows')) process.exit(0);
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('Эта сборка требует Mac с Intel или Apple Silicon.');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron/install.js')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
