'use strict';
// Repackage the existing 256px PNG from the macOS icon without redrawing it.
const fs = require('node:fs'), path = require('node:path');
const assets = path.join(__dirname, '../assets');
const source = fs.readFileSync(path.join(assets, 'icon.icns'));
let png;
for (let offset = 8; offset < source.length;) {
  const size = source.readUInt32BE(offset + 4);
  if (size < 8 || offset + size > source.length) throw new Error('Invalid ICNS');
  if (source.toString('ascii', offset, offset + 4) === 'ic08') png = source.subarray(offset + 8, offset + size);
  offset += size;
}
if (!png || png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) throw new Error('256px icon missing');
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, png]));
