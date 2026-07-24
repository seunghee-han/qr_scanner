import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { buildSnapshotPackets } from '../src/protocol.js';

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/build_packets_from_file.mjs <file> [--chunk=700] [--mime=image/webp] [--out=packets.json]');
  process.exit(2);
}

const chunkSize = Number(getArg('chunk', '700')) || 700;
const mime = getArg('mime', 'application/octet-stream');
const out = getArg('out', 'packets.json');
const requestId = getArg('request', `sample-${Date.now()}`);
const bytes = new Uint8Array(await readFile(input));
const packets = await buildSnapshotPackets({ requestId, bytes, mime, chunkSize });

await writeFile(out, JSON.stringify({
  requestId,
  file: basename(input),
  mime,
  bytes: bytes.length,
  chunkSize,
  total: packets.length,
  packets,
}, null, 2));

console.log(`wrote ${out}: ${packets.length} packets, ${bytes.length} bytes`);
