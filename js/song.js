// The song as the FM-1 keeps it: the fixed byte stream of SLICE64-FM engine/fm1_song_io.h.
import { SONG_BYTES, INSTR_BYTES, OFF_INSTR, OFF_PATTERN, ENGINE_DEFAULTS, PRESETS, NEW_SONG, DEMO_SONG, CHIP_SONG, TECHNO_SONG, ACID_SONG, GOA_SONG } from './data.js';

export const TRACKS = 4, ROWS = 64, PATTERNS = 32, ORDERS = 64, INSTRS = 32, SAMPLES = 8;
export const PAT_BYTES = 1 + ROWS * TRACKS * 4;
export const NOTE_OFF = 0xFF;
export const ENGINES = ['SID', 'FM', 'SMP'];
export const FX_LIST = ['0', '1', '2', '3', '4', 'C', 'F', 'R', 'S'];
export const FX_HELP = {
  '0': '0xy arpeggio: note, +x, +y semitones', '1': '1xx slide up (xx/16 semitone per tick)',
  '2': '2xx slide down', '3': '3xx portamento to the note, speed xx', '4': '4xy vibrato: x speed, y depth',
  'C': 'Cxx track volume 00..3F', 'F': 'Fxx below 20: speed (ticks per row), from 20: BPM',
  'R': 'Rxx retrigger every xx ticks', 'S': 'Sxx sampler: play slice xx',
};
const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
export const MIX_FIELDS = ['volume', 'mute', 'drive', 'dist', 'delay', 'reverb'];
export const DIST_NAMES = ['SOFT', 'HARD', 'FOLD', 'CRUSH'];
export const DELAY_TIMES = ['1/16', '1/8', '3/16', '1/4', '3/8', '1/2'];

export function noteName(n) {
  if (n === NOTE_OFF) return '===';
  if (!n) return '---';
  return NOTE_NAMES[(n - 1) % 12] + Math.floor((n - 1) / 12);
}

export function fromBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Instrument parameters: byte index in the 44-byte record, range, engines (bit 0 SID, 1 FM, 2 SMP), names.
const ALL = 7, SID = 1, FM = 2, SMP = 4;
export const PARAMS = [
  { id: 'type', label: 'ENGINE', i: 9, lo: 0, hi: 2, eng: ALL, names: ENGINES },
  { id: 'volume', label: 'VOLUME', i: 10, lo: 0, hi: 63, eng: ALL },
  { id: 'pan', label: 'PAN', i: 11, lo: 0, hi: 255, eng: ALL, fmt: (v) => v === 128 ? 'C' : v < 128 ? 'L' + Math.round((128 - v) * 100 / 128) : 'R' + Math.round((v - 128) * 100 / 127) },
  { id: 'transpose', label: 'TRANSP', i: 12, lo: -36, hi: 24, eng: ALL, signed: true, fmt: (v) => (v > 0 ? '+' : '') + v },
  { id: 'penv', label: 'P.ENV', i: 25, lo: -48, hi: 48, eng: ALL, signed: true, fmt: (v) => (v > 0 ? '+' : '') + v },
  { id: 'pdecay', label: 'P.DECAY', i: 26, lo: 0, hi: 15, eng: ALL },
  { id: 'a', label: 'ATTACK', i: 13, lo: 0, hi: 15, eng: ALL },
  { id: 'd', label: 'DECAY', i: 14, lo: 0, hi: 15, eng: ALL },
  { id: 's', label: 'SUSTAIN', i: 15, lo: 0, hi: 15, eng: ALL },
  { id: 'r', label: 'RELEASE', i: 16, lo: 0, hi: 15, eng: ALL },
  { id: 'fmode', label: 'FILTER', i: 17, lo: 0, hi: 3, eng: ALL, names: ['OFF', 'LOWPASS', 'BANDPASS', 'HIGHPASS'] },
  { id: 'cutoff', label: 'CUTOFF', i: 18, lo: 0, hi: 255, eng: ALL },
  { id: 'res', label: 'RESO', i: 19, lo: 0, hi: 15, eng: ALL },
  { id: 'fenv', label: 'F.ENV', i: 20, lo: -63, hi: 63, eng: ALL, signed: true, fmt: (v) => (v > 0 ? '+' : '') + v },
  { id: 'lfo_rate', label: 'LFO RATE', i: 21, lo: 0, hi: 63, eng: ALL, fmt: (v) => { const hz = 0.05 * Math.pow(400, v / 63); return (hz < 10 ? hz.toFixed(2) : hz.toFixed(1)) + 'HZ'; } },
  { id: 'lfo_depth', label: 'LFO DEPTH', i: 22, lo: 0, hi: 63, eng: ALL },
  { id: 'lfo_dest', label: 'LFO DEST', i: 23, lo: 0, hi: 3, eng: ALL, names: ['PITCH', 'CUTOFF', 'VOLUME', 'PW/MOD'] },
  { id: 'lfo_wave', label: 'LFO WAVE', i: 24, lo: 0, hi: 3, eng: ALL, names: ['TRI', 'SAW', 'SQR', 'S&H'] },
  { id: 'wave', label: 'WAVE', i: 27, lo: 0, hi: 7, eng: SID, wave: true, names: ['TRI', 'SAW', 'PULSE', 'NOISE', 'TRI+SAW', 'TRI+PUL', 'SAW+PUL', 'T+S+P'] },
  { id: 'ring', label: 'RING', i: 27, lo: 0, hi: 1, eng: SID, bit: 16, names: ['OFF', 'ON'] },
  { id: 'sync', label: 'SYNC', i: 27, lo: 0, hi: 1, eng: SID, bit: 32, names: ['OFF', 'ON'] },
  { id: 'pw', label: 'PW', i: 28, lo: 0, hi: 255, eng: SID, fmt: (v) => Math.round(v * 100 / 255) + '%' },
  { id: 'pwm', label: 'PWM', i: 29, lo: 0, hi: 63, eng: SID },
  { id: 'mod_semi', label: 'MOD SEMI', i: 30, lo: 0, hi: 24, eng: SID, signed: true },
  { id: 'detune', label: 'DETUNE', i: 31, lo: 0, hi: 63, eng: SID, fmt: (v) => v ? v + ' CENT' : 'OFF' },
  { id: 'mmul', label: 'M.MULT', i: 32, lo: 0, hi: 15, eng: FM, names: MULTS() },
  { id: 'cmul', label: 'C.MULT', i: 33, lo: 0, hi: 15, eng: FM, names: MULTS() },
  { id: 'mlevel', label: 'M.LEVEL', i: 34, lo: 0, hi: 63, eng: FM },
  { id: 'mdecay', label: 'M.DECAY', i: 35, lo: 0, hi: 15, eng: FM },
  { id: 'fb', label: 'FEEDBACK', i: 36, lo: 0, hi: 7, eng: FM },
  { id: 'mwave', label: 'M.WAVE', i: 37, lo: 0, hi: 3, eng: FM, names: ['SINE', 'HALF', 'ABS', 'PULSE'] },
  { id: 'cwave', label: 'C.WAVE', i: 38, lo: 0, hi: 3, eng: FM, names: ['SINE', 'HALF', 'ABS', 'PULSE'] },
  { id: 'sample', label: 'SAMPLE', i: 39, lo: 0, hi: SAMPLES - 1, eng: SMP, fmt: (v) => 'SLOT ' + (v + 1) },
  { id: 'slices', label: 'SLICES', i: 40, lo: 1, hi: 16, eng: SMP },
  { id: 'smode', label: 'MODE', i: 41, lo: 0, hi: 1, eng: SMP, names: ['SLICE', 'PITCH'] },
  { id: 'loop', label: 'LOOP', i: 42, lo: 0, hi: 1, eng: SMP, names: ['OFF', 'ON'] },
  { id: 'reverse', label: 'REVERSE', i: 43, lo: 0, hi: 1, eng: SMP, names: ['OFF', 'ON'] },
];
function MULTS() { return ['X0.5', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X10', 'X12', 'X12', 'X15', 'X15']; }
const WAVE_BITS = [1, 2, 4, 8, 3, 5, 6, 7];

export class Song {
  // bytes: a song stream; an older, shorter one (version 1, no TR) keeps a new song's TR
  constructor(bytes) {
    this.b = new Uint8Array(SONG_BYTES);
    this.b.set(fromBase64(NEW_SONG).subarray(0, SONG_BYTES));
    if (bytes) this.b.set(bytes.subarray ? bytes.subarray(0, SONG_BYTES) : bytes.slice(0, SONG_BYTES));
  }
  static fresh() { return new Song(fromBase64(NEW_SONG)); }
  static demo() { return new Song(fromBase64(DEMO_SONG)); }
  static chip() { return new Song(fromBase64(CHIP_SONG)); }
  static techno() { return new Song(fromBase64(TECHNO_SONG)); }
  static acid() { return new Song(fromBase64(ACID_SONG)); }
  static goa() { return new Song(fromBase64(GOA_SONG)); }
  clone() { return new Song(this.b); }

  str(off, len) { let s = ''; for (let i = 0; i < len && this.b[off + i]; i++) s += String.fromCharCode(this.b[off + i]); return s; }
  setStr(off, len, s) {
    s = s.toUpperCase().replace(/[^\x20-\x5F]/g, '').slice(0, len - 1);
    for (let i = 0; i < len; i++) this.b[off + i] = i < s.length ? s.charCodeAt(i) : 0;
  }

  get name() { return this.str(0, 16); }
  set name(s) { this.setStr(0, 16, s); }
  get bpm() { return this.b[16]; }
  set bpm(v) { this.b[16] = clamp(v, 40, 250); }
  get speed() { return this.b[17]; }
  set speed(v) { this.b[17] = clamp(v, 1, 31); }
  mix(t, field) { return this.b[18 + t * 6 + MIX_FIELDS.indexOf(field)]; }
  setMix(t, field, v) { this.b[18 + t * 6 + MIX_FIELDS.indexOf(field)] = v; }
  get delayTime() { return this.b[42]; } set delayTime(v) { this.b[42] = clamp(v, 0, 5); }
  get delayFb() { return this.b[43]; } set delayFb(v) { this.b[43] = clamp(v, 0, 63); }
  get revSize() { return this.b[44]; } set revSize(v) { this.b[44] = clamp(v, 0, 63); }
  get revDamp() { return this.b[45]; } set revDamp(v) { this.b[45] = clamp(v, 0, 63); }
  get numOrders() { return this.b[46]; } set numOrders(v) { this.b[46] = clamp(v, 1, ORDERS); }
  order(i) { return this.b[47 + i]; }
  setOrder(i, p) { this.b[47 + i] = clamp(p, 0, PATTERNS - 1); }

  // instruments (0-based index)
  instrOff(i) { return OFF_INSTR + i * INSTR_BYTES; }
  instrBytes(i) { return this.b.subarray(this.instrOff(i), this.instrOff(i) + INSTR_BYTES); }
  instrName(i) { return this.str(this.instrOff(i), 9); }
  setInstrName(i, s) { this.setStr(this.instrOff(i), 9, s); }
  instrEngine(i) { return this.b[this.instrOff(i) + 9]; }
  param(i, p) {
    const v = this.b[this.instrOff(i) + p.i];
    if (p.wave) { const k = WAVE_BITS.indexOf(v & 15); return k < 0 ? 0 : k; }
    if (p.bit) return v & p.bit ? 1 : 0;
    return p.signed ? (v << 24 >> 24) : v;
  }
  setParam(i, p, v) {
    const o = this.instrOff(i) + p.i;
    v = clamp(v, p.lo, p.hi);
    if (p.id === 'type') { if (v !== this.instrEngine(i)) this.setEngine(i, v); return; }
    if (p.wave) this.b[o] = (this.b[o] & ~15) | WAVE_BITS[v];
    else if (p.bit) this.b[o] = v ? this.b[o] | p.bit : this.b[o] & ~p.bit;
    else this.b[o] = v & 0xFF;
  }
  setEngine(i, e) {   // like the device: the engine's defaults, the name stays
    const name = this.instrName(i);
    this.b.set(ENGINE_DEFAULTS[e], this.instrOff(i));
    this.setInstrName(i, name);
  }
  loadPreset(i, k) { this.b.set(PRESETS[k].bytes, this.instrOff(i)); }

  // patterns
  patOff(p) { return OFF_PATTERN + p * PAT_BYTES; }
  patLen(p) { const l = this.b[this.patOff(p)]; return l === 16 || l === 64 ? l : 32; }
  setPatLen(p, l) { this.b[this.patOff(p)] = l; }
  cellOff(p, r, t) { return this.patOff(p) + 1 + (r * TRACKS + t) * 4; }
  cell(p, r, t) { const o = this.cellOff(p, r, t); return { note: this.b[o], instr: this.b[o + 1], fx: this.b[o + 2], param: this.b[o + 3] }; }
  setCell(p, r, t, c) {
    const o = this.cellOff(p, r, t);
    if (c.note !== undefined) this.b[o] = c.note;
    if (c.instr !== undefined) this.b[o + 1] = c.instr;
    if (c.fx !== undefined) this.b[o + 2] = c.fx;
    if (c.param !== undefined) this.b[o + 3] = c.param;
  }
  patternBytes(p) { return this.b.slice(this.patOff(p), this.patOff(p) + PAT_BYTES); }
  setPatternBytes(p, bytes) { this.b.set(bytes, this.patOff(p)); }
  clearPattern(p) { this.b.fill(0, this.patOff(p) + 1, this.patOff(p) + PAT_BYTES); }
  transpose(p, semis, track = -1) {
    for (let r = 0; r < ROWS; r++)
      for (let t = 0; t < TRACKS; t++) {
        if (track >= 0 && t !== track) continue;
        const o = this.cellOff(p, r, t), n = this.b[o];
        if (n && n !== NOTE_OFF) this.b[o] = clamp(n + semis, 1, 96);
      }
  }
}

export function clamp(v, lo, hi) { v = Math.round(Number(v) || 0); return v < lo ? lo : v > hi ? hi : v; }
