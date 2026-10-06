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

  async start(link, proto = 2) {
    this.releaseAll();
    this.link = link;
    this.proto = proto;
    this.cv.style.cursor = proto >= 4 ? 'pointer' : 'default';
    if (this.running) return;
    this.running = true;
    this.img = this.lctx.createImageData(LCD, LCD);
    let reset = true, bands = 0, t0 = performance.now(), frames = 0, allFails = 0;
    // SCREEN_PACK (protocol 5, firmware s2.2+): the changed bands in one capped frame. SCREEN_ALL's
    // back-to-back frames make Windows' MIDI input stop reading the port: never used, one band a
    // request with older firmware instead.
    this.burst = proto >= 5;
    while (this.running) {
      if (!this.link || this.paused()) { await sleep(150); reset = true; continue; }
      let r;
      if (this.burst) {   // the changed bands in one request
        try { r = await this.link.screenPack(reset); allFails = 0; }
        catch (e) {
          if (++allFails >= 2) { this.burst = false; this.status.textContent = 'Live: one band a request (slower)'; }
          else { this.status.textContent = 'No screen from the FM-1 (' + e.message + '), retrying…'; await sleep(300); }
          reset = true;
          continue;
        }
        reset = false;
        this.lights = r;
        for (const b of r.bands) {
          decodeBand(b.data, this.img.data, b.band * LCD * BAND_ROWS * 4);
          this.lctx.putImageData(this.img, 0, 0, 0, b.band * BAND_ROWS, LCD, BAND_ROWS);
        }
        if (r.sent) frames++;
        this.draw();
        if (!r.sent) await sleep(15);
        const now = performance.now();
        if (now - t0 > 1000) { this.status.textContent = `Live: ${frames} update${frames === 1 ? '' : 's'} / s`; frames = 0; t0 = now; }
        continue;
      }
      try { r = await this.link.screen(reset); }
      catch (e) { this.status.textContent = 'No screen from the FM-1 (' + e.message + '), retrying…'; await sleep(1000); reset = true; continue; }
      reset = false;
      this.lights = r;
      if (r.band !== 127) {
        decodeBand(r.data, this.img.data, r.band * LCD * BAND_ROWS * 4);
        this.lctx.putImageData(this.img, 0, 0, 0, r.band * BAND_ROWS, LCD, BAND_ROWS);
        bands++;
      } else {
        if (bands) frames++;
        bands = 0;
        this.draw();
        await sleep(25);
      }
      const now = performance.now();
      if (now - t0 > 1000) { this.status.textContent = `Live: ${frames} screen update${frames === 1 ? '' : 's'} / s`; frames = 0; t0 = now; }
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
      rr(g, x, y, kw, kh, kw / 2, on || held ? (white ? accent : mix('#000', accent, 0.75)) : white ? '#d9dadc' : '#c9cacd',
        held ? '#ffffff' : null, 3);
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.lcd, SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const p = (c) => c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c.match(/\d+/g).map(Number);
  const x = p(a), y = p(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
