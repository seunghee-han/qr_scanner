export const PROTOCOL_PREFIX = 'ISQ1';
export const PROTOCOL_V2_PREFIX = 'ISQ2';

const CRC32_TABLE = new Uint32Array(256);
for (let n = 0; n < CRC32_TABLE.length; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[n] = c >>> 0;
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function crc32Hex(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

export function base64ToBytes(base64) {
  const clean = String(base64 || '').trim();
  const binary = typeof atob === 'function'
    ? atob(clean)
    : Buffer.from(clean, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function bytesToBase64(bytes) {
  if (typeof btoa !== 'function') {
    return Buffer.from(bytes).toString('base64');
  }
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function textToBytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  return Buffer.from(String(text), 'utf8');
}

function bytesToText(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  return Buffer.from(bytes).toString('utf8');
}

function toBase36(value) {
  return Math.max(0, Number(value) || 0).toString(36);
}

function fromBase36(value) {
  const parsed = Number.parseInt(String(value || ''), 36);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export async function sha256Hex(bytes) {
  if (globalThis.crypto?.subtle) {
    const copy = bytes.slice();
    const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  if (globalThis.process?.versions?.node) {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  }
  return null;
}

function parseIsq1(raw) {
  const parts = raw.split('|');
  if (parts.length !== 9) return null;

  const seq = Number(parts[2]);
  const total = Number(parts[3]);
  const byteLength = Number(parts[6]);
  if (!Number.isInteger(seq) || !Number.isInteger(total) || !Number.isInteger(byteLength)) return null;
  if (seq < 1 || total < 1 || seq > total || byteLength < 1) return null;

  const packet = {
    format: PROTOCOL_PREFIX,
    raw,
    requestId: parts[1],
    fullRequestId: parts[1],
    seq,
    total,
    crc32: parts[4].toLowerCase(),
    sha256: parts[5].toLowerCase(),
    byteLength,
    mime: parts[7] || 'application/octet-stream',
    data: parts[8],
    isMeta: false,
  };

  if (!packet.requestId || !packet.data) return null;
  if (!/^[0-9a-f]{8}$/.test(packet.crc32)) return null;
  if (!/^[0-9a-f]{64}$/.test(packet.sha256)) return null;
  return packet;
}

function parseIsq2(raw) {
  const parts = raw.split('|');
  if (parts.length !== 6) return null;
  const seq = fromBase36(parts[2]);
  const total = fromBase36(parts[3]);
  if (!Number.isInteger(seq) || !Number.isInteger(total)) return null;
  if (seq < 0 || total < 1 || seq > total) return null;

  const packet = {
    format: PROTOCOL_V2_PREFIX,
    raw,
    requestId: parts[1],
    fullRequestId: '',
    seq,
    total,
    crc32: parts[4].toLowerCase(),
    sha256: '',
    byteLength: 0,
    mime: '',
    data: parts[5],
    isMeta: seq === 0,
  };

  if (!/^[0-9a-f]{6,16}$/.test(packet.requestId)) return null;
  if (!packet.data || !/^[0-9a-f]{8}$/.test(packet.crc32)) return null;
  return packet;
}

export function parseSnapshotQrPayload(rawValue) {
  const raw = String(rawValue || '').trim();
  if (raw.startsWith(`${PROTOCOL_PREFIX}|`)) return parseIsq1(raw);
  if (raw.startsWith(`${PROTOCOL_V2_PREFIX}|`)) return parseIsq2(raw);
  return null;
}

export function isPacketCompatible(a, b) {
  if ((a.format || PROTOCOL_PREFIX) === PROTOCOL_V2_PREFIX || (b.format || PROTOCOL_PREFIX) === PROTOCOL_V2_PREFIX) {
    return a.format === b.format && a.requestId === b.requestId && a.total === b.total;
  }
  return a.requestId === b.requestId
    && a.total === b.total
    && a.sha256 === b.sha256
    && a.byteLength === b.byteLength
    && a.mime === b.mime;
}

export function validatePacketCrc(packet) {
  try {
    return crc32Hex(base64ToBytes(packet.data)) === packet.crc32;
  } catch {
    return false;
  }
}

function parseIsq2Metadata(packet) {
  const metaBytes = base64ToBytes(packet.data);
  if (crc32Hex(metaBytes) !== packet.crc32) throw new Error('metadata crc mismatch');
  const meta = JSON.parse(bytesToText(metaBytes));
  const fullRequestId = String(meta.r || '');
  const byteLength = Number(meta.b);
  const mime = String(meta.m || 'application/octet-stream');
  const sha256 = String(meta.s || '').toLowerCase();
  if (!fullRequestId || !Number.isInteger(byteLength) || byteLength < 1) throw new Error('invalid metadata');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('invalid metadata sha256');
  return {
    format: PROTOCOL_V2_PREFIX,
    requestId: packet.requestId,
    fullRequestId,
    total: packet.total,
    byteLength,
    mime,
    sha256,
  };
}

export async function assembleSnapshotPackets(packets, metadata = null) {
  const firstPacket = packets.values().next().value;
  const first = metadata || firstPacket;
  if (!first) throw new Error('no snapshot packets');
  if (packets.size !== first.total) throw new Error('snapshot packets are incomplete');
  if (!first.byteLength || !first.sha256 || !first.mime) throw new Error('snapshot metadata is missing');

  const bytes = new Uint8Array(first.byteLength);
  let offset = 0;
  for (let seq = 1; seq <= first.total; seq += 1) {
    const packet = packets.get(seq);
    if (!packet) throw new Error(`missing snapshot packet ${seq}`);
    if (!isPacketCompatible(first, packet)) throw new Error('mixed snapshot packets');
    if (!validatePacketCrc(packet)) throw new Error(`crc mismatch at packet ${seq}`);
    const chunk = base64ToBytes(packet.data);
    if (offset + chunk.length > bytes.length) throw new Error('snapshot payload overflow');
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== bytes.length) throw new Error('snapshot payload size mismatch');

  const digest = await sha256Hex(bytes);
  if (digest && digest !== first.sha256) throw new Error('snapshot sha256 mismatch');

  return {
    requestId: first.fullRequestId || first.requestId,
    mime: first.mime,
    bytes,
    sha256: digest,
  };
}

export async function buildSnapshotPackets({ requestId, bytes, mime = 'application/octet-stream', chunkSize = 700 }) {
  const safeRequestId = String(requestId || 'sample').trim();
  const safeChunkSize = Math.max(1, Number(chunkSize) || 700);
  const imageBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!safeRequestId) throw new Error('requestId is required');
  if (imageBytes.length < 1) throw new Error('bytes are required');

  const sha = await sha256Hex(imageBytes);
  if (!sha) throw new Error('sha256 is unavailable');

  const total = Math.ceil(imageBytes.length / safeChunkSize);
  const shortId = crc32Hex(textToBytes(safeRequestId + sha)).slice(0, 10);
  const metaBytes = textToBytes(JSON.stringify({ r: safeRequestId, b: imageBytes.length, m: mime, s: sha }));
  const packets = [
    [PROTOCOL_V2_PREFIX, shortId, '0', toBase36(total), crc32Hex(metaBytes), bytesToBase64(metaBytes)].join('|'),
  ];
  for (let idx = 0; idx < total; idx += 1) {
    const rawBytes = imageBytes.subarray(idx * safeChunkSize, (idx + 1) * safeChunkSize);
    packets.push([
      PROTOCOL_V2_PREFIX,
      shortId,
      toBase36(idx + 1),
      toBase36(total),
      crc32Hex(rawBytes),
      bytesToBase64(rawBytes),
    ].join('|'));
  }
  return packets;
}

export class SnapshotAccumulator {
  constructor() {
    this.reset();
  }

  reset() {
    this.first = null;
    this.meta = null;
    this.packets = new Map();
    this.lastPacket = null;
    this.errors = [];
    this.completed = false;
    this.completedAt = 0;
  }

  addPacket(packet) {
    if (!packet) return { accepted: false, reason: 'invalid', packet };

    if (this.first && !isPacketCompatible(this.first, packet)) {
      this.reset();
    }

    if (!this.first) {
      this.first = packet;
    }

    if (packet.isMeta) {
      try {
        this.meta = parseIsq2Metadata(packet);
        this.first = this.meta;
      } catch (error) {
        this.pushError(error instanceof Error ? error.message : 'metadata error');
        return { accepted: false, reason: 'crc', packet };
      }
      this.lastPacket = packet;
      const complete = this.packets.size === this.meta.total;
      if (complete && !this.completed) {
        this.completed = true;
        this.completedAt = Date.now();
      }
      return { accepted: true, duplicate: false, complete, packet };
    }

    if (!validatePacketCrc(packet)) {
      this.pushError(`CRC 오류: ${packet.seq}`);
      return { accepted: false, reason: 'crc', packet };
    }

    if (this.first && !isPacketCompatible(this.first, packet)) {
      this.pushError('다른 스냅샷 QR이 섞였습니다');
      return { accepted: false, reason: 'mixed', packet };
    }

    const duplicate = this.packets.has(packet.seq);
    if (!duplicate) {
      this.packets.set(packet.seq, packet);
    }
    this.lastPacket = packet;

    const total = this.meta?.total || this.first?.total || 0;
    const complete = Boolean(this.meta) && this.packets.size === total;
    if (complete && !this.completed) {
      this.completed = true;
      this.completedAt = Date.now();
    }

    return { accepted: true, duplicate, complete, packet };
  }

  addRaw(rawValue) {
    const packet = parseSnapshotQrPayload(rawValue);
    if (!packet) return { accepted: false, reason: 'generic', rawValue };
    return this.addPacket(packet);
  }

  getProgress() {
    const source = this.meta || this.first;
    const total = source?.total || 0;
    const received = this.packets.size;
    const missing = total > 0 ? total - received : 0;
    const percent = total > 0 ? Math.min(100, (received / total) * 100) : 0;
    return {
      requestId: source?.fullRequestId || source?.requestId || '',
      total,
      received,
      missing,
      percent,
      byteLength: source?.byteLength || 0,
      mime: source?.mime || '',
      sha256: source?.sha256 || '',
      lastSeq: this.lastPacket?.seq || 0,
      completed: this.completed,
      missingSeqs: this.getMissingSeqs(18),
      errors: this.errors.slice(-5),
    };
  }

  getMissingSeqs(limit = 20) {
    const total = this.meta?.total || this.first?.total || 0;
    if (!total) return [];
    const out = [];
    for (let seq = 1; seq <= total; seq += 1) {
      if (!this.packets.has(seq)) out.push(seq);
      if (out.length >= limit) break;
    }
    return out;
  }

  async assemble() {
    return assembleSnapshotPackets(this.packets, this.meta);
  }

  pushError(message) {
    this.errors.push(String(message || 'error'));
    if (this.errors.length > 30) this.errors = this.errors.slice(-30);
  }
}
