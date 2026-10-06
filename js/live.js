// LIVE: the FM-1's screen and panel lights, mirrored over the link, drawn on a panel like
// the SLICE64-FM Windows emulator's (sim/panel.c geometry, 1000 x 640 units).
import { THEMES } from './data.js';

export const LCD = 240, BAND_ROWS = 8, BANDS = LCD / BAND_ROWS;
const BTN = ['FX', 'SEL', 'ENV', 'LFO', 'EDIT', 'GLO', 'HOME', 'SAVE', 'ARP', 'SEQ', 'PLAY', 'REC', 'OCT-', 'OCT+'];
const BTN_FUNC = ['PERFORM', 'SHIFT', 'FILT/ENV', 'KNOBS', 'INSTR', 'MIXER', 'TRACK', 'SEL:LOAD', 'DELETE', 'SONG', '', '', '', ''];
const KNOBS = [[105, 100, 24, 'MASTER'], [215, 100, 24, 'SELECT'], [105, 205, 24, 'PRESETS'], [215, 205, 24, 'ALGORITHM'],
  [610, 100, 22, 'KNOB1'], [714, 100, 22, 'KNOB2'], [818, 100, 22, 'KNOB3'], [922, 100, 22, 'KNOB4']];
const WHITE = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26];
const BLACK = [1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25], BLACK_AFTER = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14];
const KB = { x: 36, y: 340, w: 928, h: 270 };
const SCREEN = { x: 318, y: 62, w: 200, h: 200 };

function buttonRect(b) {
  if (b >= 12) return [b === 12 ? 72 : 170, 268, 82, 38];
  return [582 + (b % 6) * 63, b < 6 ? 174 : 236, 54, 48];
}
function keyRect(k) {
  const pitch = (KB.w - 24) / 16, kw = pitch * 0.78;
  let i = WHITE.indexOf(k);
  if (i >= 0) return [KB.x + 12 + i * pitch + (pitch - kw) / 2, KB.y + KB.h * 0.43, kw, KB.h * 0.52, true];
  i = BLACK.indexOf(k);
  return [KB.x + 12 + (BLACK_AFTER[i] + 1) * pitch - kw / 2, KB.y + KB.h * 0.06, kw, KB.h * 0.33, false];
}

// a band (encoding byte first) into RGBA pixels
export function decodeBand(d, rgba, offset) {
  const n = LCD * BAND_ROWS;
  const put = (i, c) => {
    const o = offset + i * 4;
    rgba[o] = (c >> 8 & 0xF8) | (c >> 13); rgba[o + 1] = (c >> 3 & 0xFC) | (c >> 9 & 3); rgba[o + 2] = (c << 3 & 0xF8) | (c >> 2 & 7); rgba[o + 3] = 255;
  };
  if (d[0] === 0) { const c = d[1] | d[2] << 8; for (let i = 0; i < n; i++) put(i, c); return; }
  if (d[0] === 1 || d[0] === 2) {
    const np = d[0] === 1 ? d[1] : d[1] + 1, pal = [];
    for (let k = 0; k < np; k++) pal.push(d[2 + 2 * k] | d[3 + 2 * k] << 8);
    const base = 2 + 2 * np;
    if (d[0] === 1) for (let i = 0; i < n; i++) put(i, pal[(d[base + (i >> 1)] >> (i & 1 ? 4 : 0)) & 15]);
    else for (let i = 0; i < n; i++) put(i, pal[d[base + i]]);
    return;
  }
  if (d[0] === 4) {   // palette + runs: (length - 1) << 4 | colour
    const np = d[1], pal = [];
    for (let k = 0; k < np; k++) pal.push(d[2 + 2 * k] | d[3 + 2 * k] << 8);
    let i = 0;
    for (let p = 2 + 2 * np; p < d.length && i < n; p++) {
      const c = pal[d[p] & 15];
      for (let r = (d[p] >> 4) + 1; r > 0 && i < n; r--) put(i++, c);
    }
    return;
  }
  for (let i = 0; i < n; i++) {   // RGB332
    const v = d[1 + i], o = offset + i * 4;
    rgba[o] = (v & 0xE0) * 255 / 224; rgba[o + 1] = (v << 3 & 0xE0) * 255 / 224; rgba[o + 2] = (v & 3) * 85; rgba[o + 3] = 255;
  }
}

export class Live {
  constructor(canvas, statusEl) {
    this.cv = canvas;
    this.status = statusEl;
    this.lcd = document.createElement('canvas');
    this.lcd.width = this.lcd.height = LCD;
    this.lctx = this.lcd.getContext('2d');
    this.img = this.lctx.createImageData(LCD, LCD);
    this.lctx.fillStyle = '#05070a'; this.lctx.fillRect(0, 0, LCD, LCD);
    this.lctx.fillStyle = '#5d6370'; this.lctx.font = '600 15px "Segoe UI", sans-serif'; this.lctx.textAlign = 'center';
    this.lctx.fillText('NO SIGNAL', LCD / 2, LCD / 2 - 4);
    this.lctx.font = '12px "Segoe UI", sans-serif';
    this.lctx.fillText('connect the FM-1 (Device tab)', LCD / 2, LCD / 2 + 16);
    this.lights = { lit: 0, glow: 0x3FFF, keys: 0, theme: 0 };
    this.running = false;
    this.link = null;
    this.paused = () => false;
    // the panel plays the FM-1 (protocol 4): what this page holds down, per pointer
    this.held = new Set();          // 'b3', 'k12': buttons and keys held from here
    this.latched = new Set();       // buttons held by a right-click / Shift-click until clicked again
    this.pointers = new Map();      // pointerId -> { type, id, acc, lastY }
    this.knobDeg = KNOBS.map(() => 0);
    this.inputs = Promise.resolve();
    this._bindPointer();
    new ResizeObserver(() => this.draw()).observe(canvas);
    this.draw();
  }

  get interactive() { return !!this.link && this.proto >= 4; }

  // The computer keyboard plays the FM-1 too, as in the SLICE64-FM Windows emulator (physical key
  // positions, so QWERTY and AZERTY alike). active(): the Live tab is shown.
  bindKeyboard(active) {
    const BTN = { Space: 10, Enter: 11, NumpadEnter: 11, Escape: 6, Delete: 8, ShiftLeft: 1, ShiftRight: 1,
      F1: 6, F2: 4, F3: 5, F4: 0, F5: 9, KeyZ: 12, KeyX: 13 };
    const WHITE = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26];
    const BLACK = [1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25];
    const KEY = {};
    'QWERTYUI'.split('').forEach((c, i) => { KEY['Key' + c] = WHITE[i]; });
    'ASDFGHJK'.split('').forEach((c, i) => { KEY['Key' + c] = WHITE[8 + i]; });
    ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus']
      .forEach((c, i) => { KEY[c] = BLACK[i]; });
    const KNOB = { PageUp: [4, 1], PageDown: [4, -1], Home: [5, 1], End: [5, -1], NumpadAdd: [6, 1], NumpadSubtract: [6, -1],
      NumpadMultiply: [7, 1], NumpadDivide: [7, -1] };
    const usable = (e) => active() && this.interactive && !e.ctrlKey && !e.metaKey && !e.altKey &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement);
    document.addEventListener('keydown', (e) => {
      if (!usable(e)) return;
      const track = (this.lights.lit >> 6) & 1;          // HOME lit: the TRACK page (arrows as the cursor goes)
      const ARROW = { ArrowUp: [track ? 3 : 1, -1], ArrowDown: [track ? 3 : 1, 1], ArrowLeft: [track ? 1 : 3, -1], ArrowRight: [track ? 1 : 3, 1] };
      let done = true;
      if (e.code in ARROW) this._turn(...ARROW[e.code]);
      else if (e.code in KNOB) this._turn(...KNOB[e.code]);
      else if (e.code === 'Tab') this._turn(2, e.shiftKey ? -1 : 1);
      else if (e.code === 'Backspace') { if (!e.repeat) { this._press('b1', true); this._press('b8', true); this._press('b8', false); this._press('b1', false); } }
      else if (e.code in BTN) { if (!e.repeat) this._press('b' + BTN[e.code], true); }
      else if (e.code in KEY) { if (!e.repeat) this._press('k' + KEY[e.code], true); }
      else done = false;
      if (done) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => {
      if (!this.interactive) return;
      if (e.code in BTN) this._press('b' + BTN[e.code], false);
      else if (e.code in KEY) this._press('k' + KEY[e.code], false);
    });
  }

  _send(kind, id, value) {
    if (!this.interactive) return;
    const link = this.link;
    this.inputs = this.inputs.then(() => link.input(kind, id, value)).then((l) => { this.lights = { ...this.lights, ...l }; this.draw(); })
      .catch((e) => { this.status.textContent = 'Input lost: ' + e.message; });
  }
  _press(key, on) {   // key: 'b3' or 'k12'
    const kind = key[0] === 'b' ? 0 : 1, id = +key.slice(1);
    if (on === this.held.has(key)) return;
    if (on) this.held.add(key); else this.held.delete(key);
    this._send(kind, id, on ? 1 : 0);
    this.draw();
  }
  releaseAll() {
    for (const k of [...this.held]) this._press(k, false);
    this.latched.clear();
    this.pointers.clear();
  }

  _unit(e) {
    const r = this.cv.getBoundingClientRect();
    return [(e.clientX - r.left) * 1000 / r.width, (e.clientY - r.top) * 1000 / r.width];
  }
  _hit(ux, uy) {
    for (let i = 0; i < KNOBS.length; i++) {
      const [x, y, r] = KNOBS[i];
      if ((ux - x) ** 2 + (uy - y) ** 2 <= (r + 14) ** 2) return { type: 'knob', id: i };
    }
    for (let b = 0; b < 14; b++) {
      const [x, y, w, h] = buttonRect(b);
      if (ux >= x && ux < x + w && uy >= y && uy < y + h) return { type: 'button', id: b };
    }
    for (let k = 0; k < 27; k++) {
      const [x, y, w, h] = keyRect(k);
      if (ux >= x && ux < x + w && uy >= y && uy < y + h) return { type: 'key', id: k };
    }
    return null;
  }

  _bindPointer() {
    const cv = this.cv;
    cv.style.touchAction = 'none';
    cv.oncontextmenu = (e) => e.preventDefault();
    cv.addEventListener('pointerdown', (e) => {
      if (!this.interactive) return;
      const h = this._hit(...this._unit(e));
      if (!h) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      if (h.type === 'button') {
        const key = 'b' + h.id;
        if (e.button === 2 || e.shiftKey) {        // hold / let go: combos with one mouse
          if (this.latched.has(key)) { this.latched.delete(key); this._press(key, false); }
          else { this.latched.add(key); this._press(key, true); }
          return;
        }
        this._press(key, true);
        this.pointers.set(e.pointerId, { type: 'button', key });
      } else if (h.type === 'key') {
        const key = 'k' + h.id;
        this._press(key, true);
        this.pointers.set(e.pointerId, { type: 'key', key });
      } else if (h.id > 0) {                       // not MASTER: the pot is the hardware's
        this.pointers.set(e.pointerId, { type: 'knob', id: h.id, acc: 0, lastY: e.clientY });
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (p.type === 'key') {                      // glide across the keys
        const h = this._hit(...this._unit(e));
        if (h && h.type === 'key' && 'k' + h.id !== p.key) { this._press(p.key, false); p.key = 'k' + h.id; this._press(p.key, true); }
      } else if (p.type === 'knob') {
        p.acc += p.lastY - e.clientY;
        p.lastY = e.clientY;
        const steps = Math.trunc(p.acc / 10);
        if (steps) { p.acc -= steps * 10; this._turn(p.id, steps); }
      }
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p) return;
      if (p.type === 'button' || p.type === 'key') this._press(p.key, false);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      if (!this.interactive) return;
      const h = this._hit(...this._unit(e));
      if (!h || h.type !== 'knob' || h.id === 0) return;
      e.preventDefault();
      this._turn(h.id, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }
  _turn(id, steps) {
    this.knobDeg[id] = (this.knobDeg[id] + steps * 15) % 360;
    this._send(2, id, steps);
    this.draw();
  }

  // One loop at a time (a new start retires the old one), and paced: Windows' MIDI input is read
  // more slowly than the FM-1 can answer; a request every few ms floods it, frames get lost and the
  // port stops delivering anything. At most ~20 screen requests a second, fewer while nothing changes.
  async start(link, proto = 2) {
    this.releaseAll();
    this.link = link;
    this.proto = proto;
    this.cv.style.cursor = proto >= 4 ? 'pointer' : 'default';
    const id = (this.loopId = (this.loopId || 0) + 1);
    this.running = true;
    this.img = this.lctx.createImageData(LCD, LCD);
    let reset = true, bands = 0, t0 = performance.now(), frames = 0, fails = 0, last = 0;
    let gap = MIN_GAP;   // adaptive: shrinks while replies come quickly, doubles when one is late or lost
    // SCREEN_PACK (protocol 5, firmware s2.2+): the changed bands in one capped frame; older firmware:
    // one band a request (SCREEN_ALL's back-to-back frames are never used)
    this.burst = proto >= 5;
    const alive = () => this.running && this.loopId === id;
    while (alive()) {
      if (!this.link || this.paused()) { await sleep(150); reset = true; continue; }
      const wait = last + gap - performance.now();
      if (wait > 0) await sleep(wait);
      last = performance.now();
      let r;
      try { r = await (this.burst ? this.link.screenPack(reset) : this.link.screen(reset)); fails = 0; }
      catch (e) {
        gap = Math.min(MAX_GAP, gap * 2);
        if (this.burst && ++fails >= 3) { this.burst = false; fails = 0; }
        this.status.textContent = 'No screen from the FM-1 (' + e.message + '), retrying…';
        await sleep(500);
        reset = true;
        continue;
      }
      if (!alive()) break;
      {   // a reply that took long means the MIDI input is struggling: back off; else speed up again
        const took = performance.now() - last;
        gap = took > 250 ? Math.min(MAX_GAP, gap * 2) : Math.max(MIN_GAP, gap * 0.9);
      }
      reset = false;
      this.lights = r;
      const list = this.burst ? r.bands : r.band !== 127 ? [{ band: r.band, data: r.data }] : [];
      for (const b of list) {
        decodeBand(b.data, this.img.data, b.band * LCD * BAND_ROWS * 4);
        this.lctx.putImageData(this.img, 0, 0, 0, b.band * BAND_ROWS, LCD, BAND_ROWS);
      }
      bands += list.length;
      if (!list.length || this.burst) {
        if (bands) frames++;
        bands = 0;
        this.draw();
      }
      if (!list.length) await sleep(IDLE_GAP);   // a still screen: look again a little later
      const now = performance.now();
      if (now - t0 > 1000) { this.status.textContent = `Live: ${frames} update${frames === 1 ? '' : 's'} / s (pace ${Math.round(gap)} ms)`; frames = 0; t0 = now; }
    }
  }
  stop() { this.releaseAll(); this.running = false; }

  draw() {
    const cv = this.cv, dpr = devicePixelRatio || 1;
    const w = Math.max(200, cv.clientWidth), h = w * 640 / 1000;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px'; }
    const g = cv.getContext('2d'), s = cv.width / 1000;
    const L = this.lights, accent = `rgb(${(THEMES[L.theme] || THEMES[0]).led.join(',')})`;
    g.setTransform(s, 0, 0, s, 0, 0);
    g.fillStyle = '#131518'; g.fillRect(0, 0, 1000, 640);
    rr(g, 4, 4, 992, 632, 44, '#3a3d42');
    KNOBS.forEach(([x, y, r, label], i) => {
      const a = this.knobDeg[i] * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a);
      circle(g, x, y, r + 5, '#26282c');
      circle(g, x, y, r, '#1f2124', '#44474c');
      g.strokeStyle = '#e8e8ea'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + sa * (r - 5), y - ca * (r - 5)); g.lineTo(x + sa * (r - 15), y - ca * (r - 15)); g.stroke();
      text(g, label, x, y - r - 12, 17, '#e8e8ea', 600);
    });
    rr(g, 58, 258, 210, 58, 14, '#26282c');
    rr(g, 300, 44, 236, 236, 26, '#111214');
    rr(g, 568, 160, 400, 140, 18, '#26282c');
    for (let b = 0; b < 14; b++) {
      const [x, y, bw, bh] = buttonRect(b), lit = L.lit >> b & 1, glow = L.glow >> b & 1;
      const held = this.held.has('b' + b);
      rr(g, x, y, bw, bh, 9, lit ? accent : glow ? mix('#2e3135', accent, 0.13) : '#2e3135',
        this.latched.has('b' + b) ? '#6fc3ff' : held ? accent : '#4a4d52', held ? 3 : 1.5);
      const ink = lit ? '#1b1205' : '#e8e8ea', fn = lit ? '#3c2305' : '#f0a043';
      if (b === 10) { text(g, 'PLAY', x + bw / 2, y + bh / 2 - 1, 12, ink, 600); text(g, 'STOP', x + bw / 2, y + bh / 2 + 12, 12, ink, 600); }
      else if (BTN_FUNC[b]) { text(g, BTN[b], x + bw / 2, y + bh / 2 + 1, 15, ink, 600); text(g, BTN_FUNC[b], x + bw / 2, y + bh - 7, 10.5, fn, 600); }
      else text(g, BTN[b], x + bw / 2, y + bh / 2 + 5, 15, ink, 600);
    }
    rr(g, KB.x, KB.y, KB.w, KB.h, 18, '#26282c');
    for (let k = 0; k < 27; k++) {
      const [x, y, kw, kh, white] = keyRect(k), on = L.keys >> k & 1, held = this.held.has('k' + k);
      rr(g, x, y, kw, kh, kw / 2, on || held ? (white ? accent : mix('#000000', accent, 0.75)) : white ? '#d9dadc' : '#c9cacd',
        held ? '#ffffff' : null, 3);
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.lcd, SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_GAP = 15, MAX_GAP = 200, IDLE_GAP = 40;   // ms between screen requests (adaptive) / after a still screen
function rr(g, x, y, w, h, r, fill, stroke, lw = 1) {
  g.beginPath(); g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  g.fillStyle = fill; g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function circle(g, x, y, r, fill, stroke) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
}
function text(g, s, x, y, size, color, weight = 400) {
  g.font = `${weight} ${size}px "Bahnschrift SemiCondensed", "Bahnschrift", "Segoe UI", sans-serif`;
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText(s, x, y);
}
function mix(a, b, t) {   // a and b: '#rrggbb' or 'rgb(r,g,b)'
  const p = (c) => c.startsWith('#')
    ? (c.length === 4 ? [...c.slice(1)].map((h) => parseInt(h + h, 16)) : [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)))
    : c.match(/\d+/g).map(Number);   // #rgb, #rrggbb or rgb(r,g,b)
  const x = p(a), y = p(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
