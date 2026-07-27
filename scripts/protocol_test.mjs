import assert from 'node:assert/strict';
import {
  SnapshotAccumulator,
  assembleSnapshotPackets,
  base64ToBytes,
  buildSnapshotPackets,
  crc32Hex,
  parseSnapshotQrPayload,
} from '../src/protocol.js';

const bytes = new Uint8Array(4096);
for (let i = 0; i < bytes.length; i += 1) {
  bytes[i] = (i * 31 + 7) % 256;
}

const packets = await buildSnapshotPackets({
  requestId: 'test-request-001',
  bytes,
  mime: 'image/webp',
  chunkSize: 333,
});

assert.equal(packets.length, Math.ceil(bytes.length / 333) + 1);

const parsed = packets.map((packet) => parseSnapshotQrPayload(packet));
assert.ok(parsed.every(Boolean));
assert.equal(parsed[0].seq, 0);
assert.equal(parsed[0].isMeta, true);
assert.equal(parsed.at(-1).seq, packets.length - 1);
assert.equal(crc32Hex(base64ToBytes(parsed[1].data)), parsed[1].crc32);

const metaPacket = parsed[0];
const dataPackets = parsed.slice(1);
const accForMeta = new SnapshotAccumulator();
assert.equal(accForMeta.addPacket(metaPacket).accepted, true);
for (const packet of dataPackets) assert.equal(accForMeta.addPacket(packet).accepted, true);
const map = new Map(dataPackets.map((packet) => [packet.seq, packet]));
const assembled = await accForMeta.assemble();
assert.equal(assembled.requestId, 'test-request-001');
assert.equal(assembled.mime, 'image/webp');
assert.deepEqual(Array.from(assembled.bytes), Array.from(bytes));
assert.equal(assembled.sha256, accForMeta.getProgress().sha256);

const acc = new SnapshotAccumulator();
for (const packet of parsed.slice().reverse()) {
  const result = acc.addPacket(packet);
  assert.equal(result.accepted, true);
}
assert.equal(acc.getProgress().completed, true);
assert.equal(acc.getProgress().missing, 0);
const assembledFromAcc = await acc.assemble();
assert.deepEqual(Array.from(assembledFromAcc.bytes), Array.from(bytes));

const bad = packets[1].replace(/.$/, packets[1].endsWith('A') ? 'B' : 'A');
assert.equal(parseSnapshotQrPayload('hello'), null);
assert.equal(parseSnapshotQrPayload(bad)?.seq, 1);
const badAcc = new SnapshotAccumulator();
assert.equal(badAcc.addRaw(bad).accepted, false);

console.log(`protocol ok: ${packets.length} packets, ${bytes.length} bytes`);
