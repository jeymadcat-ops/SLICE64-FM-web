// The FM-1 sample bank: 8 slots of 8-bit signed audio at their own rate, laid end to end
// in flash (SLICE64-FM firmware/fm1_link.h: header entries of 24 bytes).
import { SAMPLES, fromBase64 } from './song.js';
import { DEMO_SAMPLES } from './data.js';

export const RATES = [8000, 11025, 16000, 22050, 32000];
export const ENTRY_BYTES = 24;

export class Slot {
  constructor() { this.clear(); }
  clear() {
    this.name = '';
    this.src = null;        // Float32Array mono, the original
    this.srcRate = 0;
    this.trimStart = 0;     // in source samples
    this.trimEnd = 0;
    this.rate = 16000;
    this.gainDb = 0;
    this.normalize = true;
    this.data = null;       // Int8Array, what goes to the FM-1
  }
  get empty() { return !this.data || !this.data.length; }
  get seconds() { return this.empty ? 0 : this.data.length / this.rate; }
}

export class Bank {
  constructor() { this.slots = Array.from({ length: SAMPLES }, () => new Slot()); this.capacity = 188416; }

  get used() { return this.slots.reduce((n, s) => n + (s.empty ? 0 : s.data.length), 0); }

  // data + entries for the upload (BANK_WRITE / BANK_END)
  image() {
    const data = new Uint8Array(this.used), entries = new Uint8Array(SAMPLES * ENTRY_BYTES);
    const dv = new DataView(entries.buffer);
    let off = 0;
    this.slots.forEach((s, i) => {
      if (s.empty) return;
      const e = i * ENTRY_BYTES;
      for (let k = 0; k < 8; k++) entries[e + k] = k < s.name.length ? s.name.charCodeAt(k) : 0;
      dv.setUint32(e + 8, s.rate, true);
      dv.setUint32(e + 12, off, true);
      dv.setUint32(e + 16, s.data.length, true);
      data.set(new Uint8Array(s.data.buffer, s.data.byteOffset, s.data.length), off);
      off += s.data.length;
    });
    return { data, entries };
  }

  // the demo's drum break (from the engine, data.js)
  loadDemo() {
    this.slots.forEach((s) => s.clear());
    for (const d of DEMO_SAMPLES) {
      const s = this.slots[d.slot], raw = fromBase64(d.data);
      s.name = d.name;
      s.srcRate = d.rate;
      s.src = Float32Array.from(new Int8Array(raw.buffer), (v) => v / 128);
      s.trimStart = 0;
      s.trimEnd = s.src.length;
      s.rate = d.rate;
      s.normalize = false;
      s.data = new Int8Array(raw.buffer);
    }
  }

  // read back from the device: BANK_INFO slots + the data
  fromDevice(info, data) {
    let off = 0;
    this.slots.forEach((s, i) => {
      s.clear();
      const d = info.slots[i];
      if (!d || !d.len) return;
      s.name = d.name;
      s.rate = s.srcRate = d.rate;
      s.data = new Int8Array(data.slice(off, off + d.len).buffer);
      s.src = Float32Array.from(s.data, (v) => v / 128);
      s.trimStart = 0;
      s.trimEnd = d.len;
      s.normalize = false;
      off += d.len;
    });
  }
}

// mono Float32Array from any audio file the browser decodes
export async function decodeFile(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const n = buf.length, mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    return { mono, rate: buf.sampleRate };
  } finally { ctx.close(); }
}

// trim, resample (the browser's own resampler, band-limited), gain, 8 bits with a little dither
export async function render(slot) {
  if (!slot.src) { slot.data = null; return; }
  const a = Math.max(0, Math.min(slot.trimStart, slot.src.length)), b = Math.max(a + 1, Math.min(slot.trimEnd, slot.src.length));
  const part = slot.src.subarray(a, b);
  const outLen = Math.max(2, Math.round(part.length * slot.rate / slot.srcRate));
  let res;
  if (slot.rate === slot.srcRate) res = Float32Array.from(part);
  else {
    const off = new OfflineAudioContext(1, outLen, slot.rate);
    const buf = off.createBuffer(1, part.length, slot.srcRate);
    buf.copyToChannel(part, 0);
    const node = off.createBufferSource();
    node.buffer = buf;
    node.connect(off.destination);
    node.start();
    res = (await off.startRendering()).getChannelData(0);
  }
  let peak = 0;
  for (const v of res) peak = Math.max(peak, Math.abs(v));
  const g = (slot.normalize && peak > 1e-6 ? 0.99 / peak : 1) * Math.pow(10, slot.gainDb / 20);
  const out = new Int8Array(res.length);
  for (let i = 0; i < res.length; i++) {
    const v = Math.round(res[i] * g * 127 + (Math.random() - Math.random()) * 0.5);
    out[i] = v > 127 ? 127 : v < -128 ? -128 : v;
  }
  slot.data = out;
}

export function play(slot, ctx) {
  if (slot.empty) return null;
  const buf = ctx.createBuffer(1, slot.data.length, slot.rate);
  buf.copyToChannel(Float32Array.from(slot.data, (v) => v / 128), 0);
  const n = ctx.createBufferSource();
  n.buffer = buf;
  n.connect(ctx.destination);
  n.start();
  return n;
}

// project file (.s64p): "S64P", version 1, the song stream, then 8 slots (name[8], rate, len, data)
export function projectFile(song, bank) {
  const parts = [];
  const head = new Uint8Array(12), hv = new DataView(head.buffer);
  head.set([0x53, 0x36, 0x34, 0x50]);
  hv.setUint32(4, 1, true);
  hv.setUint32(8, song.b.length, true);
  parts.push(head, song.b);
  for (const s of bank.slots) {
    const h = new Uint8Array(16), dv = new DataView(h.buffer);
    for (let k = 0; k < 8; k++) h[k] = k < s.name.length ? s.name.charCodeAt(k) : 0;
    dv.setUint32(8, s.empty ? 0 : s.rate, true);
    dv.setUint32(12, s.empty ? 0 : s.data.length, true);
    parts.push(h);
    if (!s.empty) parts.push(new Uint8Array(s.data.buffer, s.data.byteOffset, s.data.length));
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

export function readProject(buf) {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  if (b.length < 12 || String.fromCharCode(...b.subarray(0, 4)) !== 'S64P' || dv.getUint32(4, true) !== 1)
    throw new Error('not a SLICE64-FM project (.s64p)');
  const songLen = dv.getUint32(8, true);
  let o = 12;
  const song = b.slice(o, o + songLen);
  o += songLen;
  const slots = [];
  for (let i = 0; i < SAMPLES && o + 16 <= b.length; i++) {
    let name = '';
    for (let k = 0; k < 8 && b[o + k]; k++) name += String.fromCharCode(b[o + k]);
    const rate = dv.getUint32(o + 8, true), len = dv.getUint32(o + 12, true);
    o += 16;
    slots.push({ name, rate, data: new Int8Array(b.slice(o, o + len).buffer) });
    o += len;
  }
  return { song, slots };
}
