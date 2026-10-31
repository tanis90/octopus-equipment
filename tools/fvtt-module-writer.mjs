export function varint(n) {
  const out = [];
  let v = n >>> 0;
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
  return out;
}

export function makeWriteBatch(ops, seq = 1) {
  const body = [];
  for (let i = 0; i < 8; i++) body.push(Number((BigInt(seq) >> BigInt(8 * i)) & 0xffn));
  body.push(ops.length & 0xff, (ops.length >> 8) & 0xff, (ops.length >> 16) & 0xff, (ops.length >> 24) & 0xff);
  for (const [key, value] of ops) {
    const kb = new TextEncoder().encode(key);
    const vb = new TextEncoder().encode(value);
    body.push(1, ...varint(kb.length), ...kb, ...varint(vb.length), ...vb);
  }
  return Uint8Array.from(body);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function makeWal(batches) {
  const out = [];
  for (const payload of batches) {
    let pos = 0;
    let first = true;
    while (pos < payload.length) {
      const used = out.length % 32768;
      const avail = 32768 - used;
      if (avail < 7) { for (let i = 0; i < avail; i++) out.push(0); continue; }
      const chunkLen = Math.min(avail - 7, payload.length - pos);
      const last = pos + chunkLen >= payload.length;
      const type = first && last ? 1 : first ? 2 : last ? 4 : 3;
      const chunk = payload.subarray(pos, pos + chunkLen);
      const crc = crc32(chunk);
      out.push(crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff,
        chunkLen & 0xff, (chunkLen >>> 8) & 0xff, type);
      for (const b of chunk) out.push(b);
      pos += chunkLen;
      first = false;
    }
  }
  return Uint8Array.from(out);
}

export function makeZip(entries) {
  const parts = [], centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameB = new TextEncoder().encode(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameB.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameB.length, true);
    lh.set(nameB, 30);
    parts.push(lh, data);
    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameB.length, true); cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    centrals.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return Buffer.concat([...parts, ...centrals, eocd].map((u) => Buffer.from(u)));
}
