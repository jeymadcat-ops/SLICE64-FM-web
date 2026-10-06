// SLICE64-FM link: SysEx requests to the FM-1 (firmware/fm1_link.c in SLICE64-FM).
// Frames: F0 7D 53 36 <cmd> <args> F7. u32 = 5 x 7 bits LSB first, u14 = 2 bytes,
// data = pack7 (groups of up to 7 bytes after a byte holding their top bits).

export const CMD = { INFO: 1, SONG_READ: 2, SONG_BEGIN: 3, SONG_WRITE: 4, SONG_END: 5, SAVE: 6, TRANSPORT: 7,
  BANK_INFO: 8, BANK_BEGIN: 9, BANK_WRITE: 10, BANK_END: 11, BANK_READ: 12, SCREEN: 13, SCREEN_ALL: 14, INPUT: 15, SCREEN_PACK: 16 };
export const RC_TEXT = ['ok', 'bad arguments', 'flash error', 'CRC mismatch', 'transfer not started', 'no flash'];
export const CHUNK = 256;
const HEAD = [0xF0, 0x7D, 0x53, 0x36];

export function u32(v) { const o = []; for (let i = 0; i < 5; i++) o.push((v >>> (7 * i)) & 0x7F); return o; }
export function u14(v) { return [v & 0x7F, (v >> 7) & 0x7F]; }
export function getU32(a, i) { return (a[i] | a[i + 1] << 7 | a[i + 2] << 14 | a[i + 3] << 21) + a[i + 4] * 0x10000000; }
export function getU14(a, i) { return a[i] | a[i + 1] << 7; }

export function pack7(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 7) {
    const k = Math.min(7, bytes.length - i);
    let mask = 0;
    for (let j = 0; j < k; j++) mask |= (bytes[i + j] >> 7) << j;
    out.push(mask);
    for (let j = 0; j < k; j++) out.push(bytes[i + j] & 0x7F);
  }
  return out;
}
export function unpack7(a, start = 0, end = a.length) {
  const out = [];
  let i = start;
  while (i < end) {
    const mask = a[i++], k = Math.min(7, end - i);
    for (let j = 0; j < k; j++) out.push(a[i + j] | ((mask >> j) & 1) << 7);
    i += k;
  }
  return Uint8Array.from(out);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes, crc = 0) {
  crc = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return ~crc >>> 0;
}

export class LinkError extends Error {}

// transport: { send(Uint8Array), onFrame: (Uint8Array) => void } (the Link sets onFrame)
export class Link {
  constructor(transport) {
    this.t = transport;
    this.pending = null;
    this.queue = Promise.resolve();
    transport.onFrame = (f) => this._frame(f);
  }

  _frame(f) {
    if (f.length < 6 || f[0] !== 0xF0 || f[1] !== 0x7D || f[2] !== 0x53 || f[3] !== 0x36) return;
    const p = this.pending, args = f.subarray(5, f.length - 1);
    if (p && f[4] === p.cmd) { this.pending = null; clearTimeout(p.timer); p.resolve(args); }
    else this.onPush?.(f[4], args);   // frames sent ahead of a reply (SCREEN_ALL's bands)
  }

  _once(cmd, args, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = null; reject(new LinkError(`no answer (command ${cmd})`)); }, timeout);
      this.pending = { cmd, resolve, timer };
      this.t.send(Uint8Array.from([...HEAD, cmd, ...args, 0xF7]));
    });
  }

  // one request at a time, retried on silence
  request(cmd, args = [], { timeout = 1500, tries = 3 } = {}) {
    const run = async () => {
      let last;
      for (let i = 0; i < tries; i++) {
        try { return await this._once(cmd, args, timeout); } catch (e) { last = e; }
      }
      throw last;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  static rc(reply, what) {
    const rc = reply[reply.length - 1];
    if (rc !== 0) throw new LinkError(`${what}: ${RC_TEXT[rc] || 'error ' + rc}`);
  }

  async info(opts) {
    const a = await this.request(CMD.INFO, [], opts);
    let s = '';
    for (let i = 13; i < a.length && a[i]; i++) s += String.fromCharCode(a[i]);
    return { proto: a[0], flash: !!(a[1] & 1), songBytes: getU32(a, 2), bankBytes: getU32(a, 7), samples: a[12], version: s };
  }

  async _read(cmd, total, progress) {
    const out = new Uint8Array(total);
    for (let off = 0; off < total; off += CHUNK) {
      const n = Math.min(CHUNK, total - off);
      const a = await this.request(cmd, [...u32(off), ...u14(n)]);
      const d = unpack7(a, 7);
      if (getU32(a, 0) !== off || d.length !== n) throw new LinkError('bad read reply');
      out.set(d, off);
      progress?.(off + n, total);
    }
    return out;
  }

  readSong(total, progress) { return this._read(CMD.SONG_READ, total, progress); }
  readBank(total, progress) { return this._read(CMD.BANK_READ, total, progress); }

  async writeSong(bytes, progress) {
    Link.rc(await this.request(CMD.SONG_BEGIN, u32(bytes.length), { timeout: 8000 }), 'song');
    for (let off = 0; off < bytes.length; off += CHUNK) {
      const chunk = bytes.subarray(off, Math.min(off + CHUNK, bytes.length));
      Link.rc(await this.request(CMD.SONG_WRITE, [...u32(off), ...pack7(chunk)]), 'song');
      progress?.(off + chunk.length, bytes.length);
    }
    Link.rc(await this.request(CMD.SONG_END, u32(crc32(bytes)), { timeout: 4000, tries: 1 }), 'song');
  }

  async save() { Link.rc(await this.request(CMD.SAVE, [], { timeout: 10000, tries: 1 }), 'save'); }

  async transport(play) { const a = await this.request(CMD.TRANSPORT, [play ? 1 : 0]); return !!a[0]; }

  async bankInfo() {
    const a = await this.request(CMD.BANK_INFO);
    const slots = [];
    let i = 6;
    for (let k = 0; k < a[0]; k++) {
      let name = '';
      while (i < a.length && a[i]) name += String.fromCharCode(a[i++]);
      i++;
      slots.push({ name, rate: getU32(a, i), len: getU32(a, i + 5) });
      i += 10;
    }
    return { dataLen: getU32(a, 1), slots };
  }

  // screen mirror (protocol 2): the next changed band of 8 rows, and the panel lights
  async screen(reset = false) {
    const a = await this.request(CMD.SCREEN, [reset ? 1 : 0], { timeout: 1500, tries: 1 });
    return { lit: getU32(a, 0), glow: getU32(a, 5), keys: getU32(a, 10), theme: a[15], band: a[16],
      data: a[16] === 127 ? null : unpack7(a, 17) };
  }

  // protocol 3: every changed band in one request (each as a SCREEN frame before the reply)
  async screenAll(reset = false) {
    const bands = [];
    this.onPush = (cmd, a) => { if (cmd === CMD.SCREEN && a[16] !== 127) bands.push({ band: a[16], data: unpack7(a, 17) }); };
    try {
      const a = await this.request(CMD.SCREEN_ALL, [reset ? 1 : 0], { timeout: 2000, tries: 1 });
      return { lit: getU32(a, 0), glow: getU32(a, 5), keys: getU32(a, 10), theme: a[15], sent: a[16], bands };
    } finally { this.onPush = null; }
  }

  // protocol 5: the changed bands in ONE frame (Windows' MIDI stack loses back-to-back SysEx)
  async screenPack(reset = false) {
    const a = await this.request(CMD.SCREEN_PACK, [reset ? 1 : 0], { timeout: 2000, tries: 1 });
    const bands = [];
    let p = 17;
    for (let k = 0; k < a[16] && p < a.length; k++) {
      const band = a[p], len = a[p + 1] | a[p + 2] << 7, packed = len + Math.ceil(len / 7);
      bands.push({ band, data: unpack7(a, p + 3, p + 3 + packed) });
      p += 3 + packed;
    }
    return { lit: getU32(a, 0), glow: getU32(a, 5), keys: getU32(a, 10), theme: a[15], sent: bands.length, bands };
  }

  // protocol 4: the editor's panel plays the FM-1 (kind 0 button, 1 key, 2 knob; value 1/0 or steps)
  async input(kind, id, value) {
    const a = await this.request(CMD.INPUT, [kind, id, ...u14(value + 8192)], { timeout: 800, tries: 3 });
    return { lit: getU32(a, 0), glow: getU32(a, 5), keys: getU32(a, 10), theme: a[15] };
  }

  // data: the bank's 8-bit data; entries: 8 x 24 bytes (name[8], rate, off, len, 0, little endian)
  async writeBank(data, entries, progress) {
    Link.rc(await this.request(CMD.BANK_BEGIN, [], { timeout: 5000 }), 'samples');
    for (let off = 0; off < data.length; off += CHUNK) {
      const chunk = data.subarray(off, Math.min(off + CHUNK, data.length));
      Link.rc(await this.request(CMD.BANK_WRITE, [...u32(off), ...pack7(chunk)], { timeout: 3000 }), 'samples');
      progress?.(off + chunk.length, data.length);
    }
    Link.rc(await this.request(CMD.BANK_END, [...u32(data.length), ...u32(crc32(data)), ...pack7(entries)],
      { timeout: 4000, tries: 1 }), 'samples');
  }
}

// Web MIDI (Chrome / Edge, SysEx permission)
export async function midiAccess() {
  if (!navigator.requestMIDIAccess) throw new LinkError('this browser has no Web MIDI: use Chrome or Edge');
  return navigator.requestMIDIAccess({ sysex: true });
}

export class MidiTransport {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.onFrame = null;
    this.buf = [];
    this.input.onmidimessage = (e) => this._data(e.data);
  }
  _data(d) {
    for (const b of d) {
      if (b === 0xF0) this.buf = [b];
      else if (this.buf.length) {
        if (b >= 0xF8) continue;                       // realtime inside SysEx
        this.buf.push(b);
        if (b === 0xF7) { const f = Uint8Array.from(this.buf); this.buf = []; this.onFrame?.(f); }
      }
    }
  }
  send(bytes) { this.output.send(bytes); }
  close() { this.input.onmidimessage = null; }
}
