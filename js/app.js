import { Song, TRACKS, PATTERNS, INSTRS, SAMPLES, NOTE_OFF, ENGINES, FX_LIST, FX_HELP, PARAMS, DIST_NAMES, DELAY_TIMES, noteName, clamp } from './song.js';
import { PRESETS, SONG_BYTES } from './data.js';
import { Bank, RATES, decodeFile, render, play, projectFile, readProject } from './bank.js';
import { Link, MidiTransport, midiAccess, LinkError } from './sysex.js';
import { Live } from './live.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');

const state = {
  song: Song.demo(), bank: new Bank(),
  pat: 0, row: 0, col: 0,            // col = track * 4 + field (note, instr, fx, param)
  instr: 1, octave: 3, step: 1, order: 0, editInstr: 0,
  clip: null, clipInstr: null,
  midi: null, transport: null, link: null, info: null, audio: null, busy: false,
};
state.bank.loadDemo();
const live = new Live($('#l-panel'), $('#l-status'));
live.paused = () => state.busy || !$('#tab-live').classList.contains('on');

/* --------------------------------------------------------------- general */

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function log(msg) { const l = $('#d-log'); l.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`; l.scrollTop = l.scrollHeight; }

let saveTimer;
function changed() {   // autosave in this browser
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const buf = new Uint8Array(await projectFile(state.song, state.bank).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      localStorage.setItem('s64-project', btoa(s));
    } catch { /* storage full or blocked: the file buttons still work */ }
  }, 800);
}

function loadProject(bytes) {
  const p = readProject(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  state.song = new Song(p.song);
  state.bank.slots.forEach((s, i) => {
    s.clear();
    const d = p.slots[i];
    if (d && d.data.length) {
      s.name = d.name; s.rate = s.srcRate = d.rate; s.data = d.data;
      s.src = Float32Array.from(d.data, (v) => v / 128); s.trimStart = 0; s.trimEnd = d.data.length; s.normalize = false;
    }
  });
}

function refreshAll() { renderSong(); renderPattern(); renderInstrList(); renderInstr(); renderSamples(); }

document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'pattern') $('#p-grid').focus();
  if (b.dataset.tab === 'live') live.draw(); else live.releaseAll();
  history.replaceState(null, '', '#' + b.dataset.tab);
});

$('#f-new').onclick = () => { if (!confirm('Start an empty song without samples?')) return; state.song = Song.fresh(); state.bank.slots.forEach((s) => s.clear()); state.pat = state.row = state.col = 0; refreshAll(); changed(); };
$('#f-demo').onclick = () => { if (!confirm('Load the jungle demo (song and samples)?')) return; state.song = Song.demo(); state.bank.loadDemo(); refreshAll(); changed(); };
$('#f-open').onclick = () => $('#f-input').click();
$('#f-input').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { loadProject(new Uint8Array(await f.arrayBuffer())); refreshAll(); changed(); toast(`${f.name} opened`); }
  catch (err) { toast(err.message, true); }
};
$('#f-save').onclick = () => {
  const a = el('a', { href: URL.createObjectURL(projectFile(state.song, state.bank)), download: (state.song.name || 'song').trim().replace(/\s+/g, '_').toLowerCase() + '.s64p' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

/* --------------------------------------------------------------- song tab */

function renderSong() {
  const s = state.song;
  $('#s-name').value = s.name;
  $('#s-bpm').value = s.bpm;
  $('#s-speed').value = s.speed;
  state.order = clamp(state.order, 0, s.numOrders - 1);
  const box = $('#s-orders');
  box.replaceChildren();
  for (let i = 0; i < s.numOrders; i++) {
    const inp = el('input', { type: 'number', min: 0, max: PATTERNS - 1, value: s.order(i) });
    inp.onchange = () => { s.setOrder(i, inp.value); inp.value = s.order(i); changed(); };
    const o = el('div', { className: 'o' + (i === state.order ? ' sel' : '') }, el('span', { textContent: hex2(i) }), inp);
    o.onclick = () => { state.order = i; box.querySelectorAll('.o').forEach((x, k) => x.classList.toggle('sel', k === i)); };
    box.append(o);
  }
  $('#s-ordinfo').textContent = `${s.numOrders} positions`;
  // mixer
  const mx = $('#s-mixer');
  mx.replaceChildren();
  for (let t = 0; t < TRACKS; t++) {
    const strip = el('div', { className: 'strip' }, el('b', { textContent: `TRACK ${t + 1}` }));
    const range = (label, field, max) => {
      const r = el('input', { type: 'range', min: 0, max, value: s.mix(t, field) }), o = el('output', { value: s.mix(t, field) });
      r.oninput = () => { s.setMix(t, field, +r.value); o.value = r.value; changed(); };
      strip.append(el('label', {}, label, r, o));
    };
    range('Volume', 'volume', 63);
    const mute = el('input', { type: 'checkbox', checked: !!s.mix(t, 'mute') });
    mute.onchange = () => { s.setMix(t, 'mute', mute.checked ? 1 : 0); changed(); };
    strip.append(el('label', { style: 'flex-direction:row;gap:6px' }, mute, 'Mute'));
    range('Drive', 'drive', 63);
    const dist = el('select');
    DIST_NAMES.forEach((n, i) => dist.append(el('option', { value: i, textContent: n, selected: s.mix(t, 'dist') === i })));
    dist.onchange = () => { s.setMix(t, 'dist', +dist.value); changed(); };
    strip.append(el('label', {}, 'Distortion', dist));
    range('Delay send', 'delay', 63);
    range('Reverb send', 'reverb', 63);
    mx.append(strip);
  }
  const dt = $('#s-dtime');
  dt.replaceChildren(...DELAY_TIMES.map((n, i) => el('option', { value: i, textContent: n, selected: s.delayTime === i })));
  for (const [id, key] of [['#s-dfb', 'delayFb'], ['#s-rsize', 'revSize'], ['#s-rdamp', 'revDamp']]) {
    const r = $(id);
    r.value = s[key];
    r.nextElementSibling.value = s[key];
  }
}
$('#s-name').oninput = (e) => { state.song.name = e.target.value; changed(); };
$('#s-bpm').onchange = (e) => { state.song.bpm = +e.target.value; e.target.value = state.song.bpm; changed(); };
$('#s-speed').onchange = (e) => { state.song.speed = +e.target.value; e.target.value = state.song.speed; changed(); };
$('#s-dtime').onchange = (e) => { state.song.delayTime = +e.target.value; changed(); };
for (const [id, key] of [['#s-dfb', 'delayFb'], ['#s-rsize', 'revSize'], ['#s-rdamp', 'revDamp']])
  $(id).oninput = (e) => { state.song[key] = +e.target.value; e.target.nextElementSibling.value = e.target.value; changed(); };

function orderOp(fn) { fn(state.song); renderSong(); changed(); }
$('#o-add').onclick = () => orderOp((s) => { if (s.numOrders < 64) { s.setOrder(s.numOrders, s.order(s.numOrders - 1)); s.numOrders++; state.order = s.numOrders - 1; } });
$('#o-ins').onclick = () => orderOp((s) => {
  if (s.numOrders >= 64) return;
  for (let i = s.numOrders; i > state.order; i--) s.setOrder(i, s.order(i - 1));
  s.numOrders++;
});
$('#o-del').onclick = () => orderOp((s) => {
  if (s.numOrders <= 1) return;
  for (let i = state.order; i < s.numOrders - 1; i++) s.setOrder(i, s.order(i + 1));
  s.numOrders--;
});
$('#o-up').onclick = () => orderOp((s) => { const i = state.order; if (i > 0) { const a = s.order(i); s.setOrder(i, s.order(i - 1)); s.setOrder(i - 1, a); state.order--; } });
$('#o-down').onclick = () => orderOp((s) => { const i = state.order; if (i < s.numOrders - 1) { const a = s.order(i); s.setOrder(i, s.order(i + 1)); s.setOrder(i + 1, a); state.order++; } });
$('#o-edit').onclick = () => { state.pat = state.song.order(state.order); renderPattern(); document.querySelector('[data-tab=pattern]').click(); };

/* --------------------------------------------------------------- pattern tab */

const FIELD_CLASS = ['note', 'ins', 'fx', 'par'];
for (let p = 0; p < PATTERNS; p++) $('#p-sel').append(el('option', { value: p, textContent: hex2(p) }));
Object.entries(FX_HELP).forEach(([k, v]) => $('#p-fxhelp').append(el('dt', { textContent: k }), el('dd', { textContent: v.slice(4) })));

function instrOptions(sel) {
  sel.replaceChildren(...Array.from({ length: INSTRS }, (_, i) =>
    el('option', { value: i + 1, textContent: `${hex2(i + 1)} ${state.song.instrName(i) || '--------'} ${ENGINES[state.song.instrEngine(i)] || ''}` })));
}

function renderPattern() {
  const s = state.song, p = state.pat, len = s.patLen(p);
  state.row = clamp(state.row, 0, len - 1);
  $('#p-sel').value = p;
  $('#p-len').value = len;
  instrOptions($('#p-instr'));
  $('#p-instr').value = state.instr;
  const grid = $('#p-grid'), keep = grid.scrollTop;
  const frag = document.createDocumentFragment();
  const head = el('div', { className: 'r head' }, el('span', { className: 'rn', textContent: '' }));
  for (let t = 0; t < TRACKS; t++) head.append(el('span', { className: 'tk', textContent: `TRACK ${t + 1}`.padEnd(13) }));
  frag.append(head);
  for (let r = 0; r < len; r++) {
    const row = el('div', { className: 'r' + (r % 4 === 0 ? ' beat' : '') + (r === state.row ? ' cur' : '') });
    row.append(el('span', { className: 'rn', textContent: hex2(r) }));
    for (let t = 0; t < TRACKS; t++) {
      const c = s.cell(p, r, t), tk = el('span', { className: 'tk' });
      const txt = [noteName(c.note), c.instr ? hex2(c.instr) : '..', c.fx ? String.fromCharCode(c.fx) : '.', c.fx ? hex2(c.param) : '..'];
      const empty = [!c.note, !c.instr, !c.fx, !c.fx];
      txt.forEach((v, f) => {
        const sp = el('span', { className: `f ${FIELD_CLASS[f]}` + (empty[f] ? ' empty' : '') + (r === state.row && state.col === t * 4 + f ? ' cur' : ''), textContent: v });
        sp.onmousedown = (e) => { e.preventDefault(); state.row = r; state.col = t * 4 + f; renderPattern(); grid.focus(); };
        tk.append(sp);
      });
      row.append(tk);
    }
    frag.append(row);
  }
  grid.replaceChildren(frag);
  grid.scrollTop = keep;
  grid.querySelector('.r.cur')?.scrollIntoView({ block: 'nearest' });
}

$('#p-sel').onchange = (e) => { state.pat = +e.target.value; renderPattern(); };
$('#p-len').onchange = (e) => { state.song.setPatLen(state.pat, +e.target.value); renderPattern(); changed(); };
$('#p-instr').onchange = (e) => { state.instr = +e.target.value; };
$('#p-oct').onchange = (e) => { state.octave = clamp(e.target.value, 0, 7); e.target.value = state.octave; };
$('#p-step').onchange = (e) => { state.step = clamp(e.target.value, 0, 16); e.target.value = state.step; };
$('#p-copy').onclick = () => { state.clip = state.song.patternBytes(state.pat); toast(`Pattern ${hex2(state.pat)} copied`); };
$('#p-paste').onclick = () => { if (!state.clip) return; state.song.setPatternBytes(state.pat, state.clip); renderPattern(); changed(); };
$('#p-clear').onclick = () => { if (!confirm(`Clear pattern ${hex2(state.pat)}?`)) return; state.song.clearPattern(state.pat); renderPattern(); changed(); };
for (const [id, semis] of [['#p-tdown', -1], ['#p-tup', 1], ['#p-odown', -12], ['#p-oup', 12]])
  $(id).onclick = (e) => { state.song.transpose(state.pat, semis, e.shiftKey ? -1 : Math.floor(state.col / 4)); renderPattern(); changed(); };

// FT2-style piano on physical key positions (e.code): the same keys on QWERTY and AZERTY
const PIANO = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28 };

function moveRow(d) { const len = state.song.patLen(state.pat); state.row = ((state.row + d) % len + len) % len; }

$('#p-grid').onkeydown = (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const s = state.song, p = state.pat, t = Math.floor(state.col / 4), f = state.col % 4, len = s.patLen(p);
  const c = s.cell(p, state.row, t);
  let handled = true, edit = false;
  switch (e.code) {
    case 'ArrowUp': moveRow(-1); break;
    case 'ArrowDown': moveRow(1); break;
    case 'ArrowLeft': state.col = (state.col + 15) % 16; break;
    case 'ArrowRight': state.col = (state.col + 1) % 16; break;
    case 'Tab': state.col = ((t + (e.shiftKey ? 3 : 1)) % 4) * 4; break;
    case 'PageUp': state.row = Math.max(0, state.row - 16); break;
    case 'PageDown': state.row = Math.min(len - 1, state.row + 16); break;
    case 'Home': state.row = 0; break;
    case 'End': state.row = len - 1; break;
    case 'Delete':
      s.setCell(p, state.row, t, f < 2 ? { note: 0, instr: 0 } : { fx: 0, param: 0 });
      moveRow(state.step); edit = true; break;
    case 'Insert':   // push the track down from the cursor
      for (let r = len - 1; r > state.row; r--) s.setCell(p, r, t, s.cell(p, r - 1, t));
      s.setCell(p, state.row, t, { note: 0, instr: 0, fx: 0, param: 0 }); edit = true; break;
    case 'Backspace':   // pull the track up into the cursor row
      for (let r = state.row; r < len - 1; r++) s.setCell(p, r, t, s.cell(p, r + 1, t));
      s.setCell(p, len - 1, t, { note: 0, instr: 0, fx: 0, param: 0 }); edit = true; break;
    default: handled = false;
  }
  if (!handled) {
    const k = e.key.toUpperCase(), hexd = /^[0-9A-F]$/.test(k) ? parseInt(k, 16) : -1;
    if (f === 0 && (e.code === 'Backquote' || e.code === 'Equal')) {
      s.setCell(p, state.row, t, { note: NOTE_OFF, instr: 0 }); moveRow(state.step); handled = edit = true;
    } else if (f === 0 && e.code in PIANO) {
      s.setCell(p, state.row, t, { note: clamp(state.octave * 12 + PIANO[e.code] + 1, 1, 96), instr: state.instr });
      moveRow(state.step); handled = edit = true;
    } else if (f === 1 && hexd >= 0) {
      let v = ((c.instr << 4) | hexd) & 0xFF;
      if (v > INSTRS) v = hexd;
      s.setCell(p, state.row, t, { instr: v }); handled = edit = true;
    } else if (f === 2 && FX_LIST.includes(k)) {
      s.setCell(p, state.row, t, { fx: k.charCodeAt(0) }); handled = edit = true;
    } else if (f === 3 && hexd >= 0) {
      if (!c.fx) { toast('Choose the effect first (FX column)'); handled = true; }
      else { s.setCell(p, state.row, t, { param: ((c.param << 4) | hexd) & 0xFF }); handled = edit = true; }
    }
  }
  if (handled) { e.preventDefault(); renderPattern(); if (edit) changed(); }
};

/* --------------------------------------------------------------- instruments */

PRESETS.forEach((pr, i) => $('#i-preset').append(el('option', { value: i, textContent: `${pr.name} (${ENGINES[pr.engine]})` })));

function renderInstrList() {
  const ol = $('#i-list');
  ol.replaceChildren();
  for (let i = 0; i < INSTRS; i++) {
    const e = state.song.instrEngine(i);
    const li = el('li', { className: i === state.editInstr ? 'sel' : '' },
      el('span', { className: 'n', textContent: hex2(i + 1) }), el('span', { textContent: (state.song.instrName(i) || '--------').padEnd(8) }),
      el('span', { className: 'eng-' + e, textContent: ENGINES[e] || '?' }));
    li.onclick = () => { state.editInstr = i; renderInstrList(); renderInstr(); };
    ol.append(li);
  }
}

function renderInstr() {
  const s = state.song, i = state.editInstr, eng = s.instrEngine(i);
  $('#i-title').textContent = `Instrument ${hex2(i + 1)}`;
  $('#i-name').value = s.instrName(i);
  const box = $('#i-params');
  box.replaceChildren();
  let group = '';
  for (const p of PARAMS) {
    if (!(p.eng & (1 << eng))) continue;
    const g = p.eng === 7 ? (p.i >= 21 && p.i <= 24 ? 'LFO' : p.i >= 17 && p.i <= 20 ? 'Filter' : 'Common') : ENGINES[eng];
    if (g !== group) { box.append(el('h3', { textContent: g })); group = g; }
    const v = s.param(i, p), out = el('output');
    const show = (x) => { out.value = p.names ? p.names[x - p.lo] ?? x : p.fmt ? p.fmt(x) : x; };
    let ctl;
    if (p.names && p.hi - p.lo < 16) {
      ctl = el('select');
      p.names.forEach((n, k) => ctl.append(el('option', { value: p.lo + k, textContent: n, selected: p.lo + k === v })));
      ctl.onchange = () => { s.setParam(i, p, +ctl.value); changed(); if (p.id === 'type') { renderInstr(); renderInstrList(); } };
      out.value = '';
    } else {
      ctl = el('input', { type: 'range', min: p.lo, max: p.hi, value: v });
      ctl.oninput = () => { s.setParam(i, p, +ctl.value); show(+ctl.value); changed(); };
      show(v);
    }
    box.append(el('div', { className: 'param' }, el('span', { textContent: p.label }), ctl, out));
  }
}
$('#i-name').oninput = (e) => { state.song.setInstrName(state.editInstr, e.target.value); renderInstrList(); changed(); };
$('#i-load').onclick = () => { state.song.loadPreset(state.editInstr, +$('#i-preset').value); renderInstr(); renderInstrList(); changed(); };
$('#i-copy').onclick = () => { state.clipInstr = state.song.instrBytes(state.editInstr).slice(); toast('Instrument copied'); };
$('#i-paste').onclick = () => { if (!state.clipInstr) return; state.song.b.set(state.clipInstr, state.song.instrOff(state.editInstr)); renderInstr(); renderInstrList(); changed(); };

/* --------------------------------------------------------------- samples */

function audio() { return (state.audio ||= new (window.AudioContext || window.webkitAudioContext)()); }

function renderUsage() {
  const used = state.bank.used, cap = state.info?.bankBytes || state.bank.capacity;
  const m = $('#b-meter');
  m.style.width = Math.min(100, used * 100 / cap) + '%';
  m.classList.toggle('full', used > cap);
  $('#b-usage').textContent = `${(used / 1024).toFixed(1)} KB used of ${(cap / 1024).toFixed(0)} KB` + (used > cap ? ' — too much: shorten, or lower a rate' : '');
}

function drawWave(slot, cv) {
  const ctx = cv.getContext('2d'), w = cv.width = cv.clientWidth * devicePixelRatio, h = cv.height = cv.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  if (!slot.src) { ctx.fillStyle = '#556'; ctx.font = `${12 * devicePixelRatio}px sans-serif`; ctx.fillText('Drop an audio file here', 10, h / 2); return; }
  const n = slot.src.length;
  ctx.fillStyle = '#ffb02e';
  for (let x = 0; x < w; x++) {
    const a = Math.floor(x * n / w), b = Math.max(a + 1, Math.floor((x + 1) * n / w));
    let lo = 1, hi = -1;
    for (let k = a; k < b; k++) { const v = slot.src[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    ctx.fillRect(x, (1 - hi) * h / 2, 1, Math.max(1, (hi - lo) * h / 2));
  }
  ctx.fillStyle = 'rgba(13,15,19,.75)';
  const xs = slot.trimStart * w / n, xe = slot.trimEnd * w / n;
  ctx.fillRect(0, 0, xs, h);
  ctx.fillRect(xe, 0, w - xe, h);
  ctx.fillStyle = '#4d8dff';
  ctx.fillRect(xs, 0, 2, h);
  ctx.fillRect(xe - 2, 0, 2, h);
}

function slotCard(i) {
  const slot = state.bank.slots[i];
  const name = el('input', { value: slot.name, maxLength: 8, placeholder: 'NAME' });
  const rate = el('select');
  RATES.forEach((r) => rate.append(el('option', { value: r, textContent: (r / 1000) + ' kHz', selected: r === slot.rate })));
  const cv = el('canvas');
  const norm = el('input', { type: 'checkbox', checked: slot.normalize });
  const gain = el('input', { type: 'number', min: -24, max: 24, value: slot.gainDb, step: 1 });
  const meta = el('div', { className: 'meta' });
  const file = el('input', { type: 'file', accept: 'audio/*', hidden: true });
  const card = el('div', { className: 'slot' },
    el('header', {}, el('b', { textContent: i + 1 }), name, rate,
      el('span', { className: 'btns' },
        el('button', { textContent: 'Load', onclick: () => file.click() }),
        el('button', { textContent: 'Play', onclick: () => play(slot, audio()) }),
        el('button', { textContent: 'Clear', onclick: () => { slot.clear(); refresh(); changed(); } }))),
    cv, el('div', { className: 'form' }, el('label', {}, norm, 'Normalize'), el('label', {}, 'Gain dB', gain)), meta, file);
  const refresh = () => {
    name.value = slot.name;
    drawWave(slot, cv);
    meta.textContent = slot.empty ? 'empty' : `${slot.seconds.toFixed(2)} s at ${slot.rate} Hz, ${(slot.data.length / 1024).toFixed(1)} KB`;
    renderUsage();
  };
  let pending;
  const rerender = () => { clearTimeout(pending); pending = setTimeout(async () => { await render(slot); refresh(); changed(); }, 120); };
  const load = async (f) => {
    try {
      const { mono, rate: r } = await decodeFile(f);
      slot.src = mono; slot.srcRate = r; slot.trimStart = 0; slot.trimEnd = mono.length; slot.normalize = true; slot.gainDb = 0;
      slot.name = f.name.replace(/\.[^.]*$/, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 8);
      norm.checked = true; gain.value = 0;
      await render(slot);
      refresh(); changed();
    } catch (err) { toast(`${f.name}: ${err.message || 'cannot decode'}`, true); }
  };
  file.onchange = () => { if (file.files[0]) load(file.files[0]); file.value = ''; };
  card.ondragover = (e) => { e.preventDefault(); card.classList.add('drag'); };
  card.ondragleave = () => card.classList.remove('drag');
  card.ondrop = (e) => { e.preventDefault(); card.classList.remove('drag'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
  name.oninput = () => { slot.name = name.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 8); changed(); };
  rate.onchange = () => { slot.rate = +rate.value; rerender(); };
  norm.onchange = () => { slot.normalize = norm.checked; rerender(); };
  gain.onchange = () => { slot.gainDb = clamp(gain.value, -24, 24); rerender(); };
  // trim: left button = start, right button / Shift = end
  let dragEnd = null;
  const at = (e) => { const r = cv.getBoundingClientRect(); return Math.round(clamp((e.clientX - r.left) / r.width * 1000, 0, 1000) / 1000 * (slot.src?.length || 0)); };
  cv.oncontextmenu = (e) => e.preventDefault();
  cv.onmousedown = (e) => { if (!slot.src) return; dragEnd = e.button === 2 || e.shiftKey; cv.onmousemove(e); };
  cv.onmousemove = (e) => {
    if (dragEnd === null) return;
    const x = at(e);
    if (dragEnd) slot.trimEnd = Math.max(x, slot.trimStart + 64); else slot.trimStart = Math.min(x, slot.trimEnd - 64);
    drawWave(slot, cv);
  };
  window.addEventListener('mouseup', () => { if (dragEnd !== null) { dragEnd = null; rerender(); } });
  requestAnimationFrame(refresh);
  return card;
}

function renderSamples() {
  $('#b-slots').replaceChildren(...Array.from({ length: SAMPLES }, (_, i) => slotCard(i)));
  renderUsage();
}

/* --------------------------------------------------------------- device */

function setBusy(b) {
  state.busy = b;
  const ok = !!state.link && !b;
  for (const id of ['#d-send-all', '#d-send-song', '#d-send-bank', '#d-read-song', '#d-read-bank', '#d-save', '#d-play', '#d-stop', '#d-test'])
    $(id).disabled = !ok;
}
function progress(done, total, what) {
  $('#d-bar').style.width = (total ? done * 100 / total : 0) + '%';
  $('#d-status').textContent = `${what}: ${Math.round(done * 100 / (total || 1))} %`;
}

function fillPorts() {
  const pick = (sel, ports) => {
    const prev = sel.value;
    sel.replaceChildren(...[...ports.values()].map((p) => el('option', { value: p.id, textContent: p.name })));
    const fm = [...ports.values()].find((p) => /fm-?1|m-?vave|slice/i.test(p.name));
    sel.value = [...ports.values()].some((p) => p.id === prev) ? prev : fm?.id ?? sel.value;
  };
  pick($('#d-out'), state.midi.outputs);
  pick($('#d-in'), state.midi.inputs);
}

async function connect() {
  try {
    if (!state.midi) { state.midi = await midiAccess(); state.midi.onstatechange = () => fillPorts(); fillPorts(); }
    state.transport?.close();
    const out = state.midi.outputs.get($('#d-out').value), inp = state.midi.inputs.get($('#d-in').value);
    if (!out || !inp) throw new LinkError('no MIDI port: is the FM-1 plugged in?');
    try { await inp.open(); await out.open(); }   // Windows: a port open in another program (a DAW, M-UPGRADE) refuses
    catch { throw new LinkError(`the MIDI port ${out.name} is busy: close the other programs using it (music software, M-UPGRADE), then reload this page`); }
    state.transport = new MidiTransport(inp, out);
    state.link = new Link(state.transport);
    const info = await state.link.info();
    state.info = info;
    if (info.songBytes !== SONG_BYTES) throw new LinkError(`the FM-1 firmware uses another song format (${info.songBytes} bytes): update this page or the firmware`);
    $('#d-info').replaceChildren(
      el('dt', { textContent: 'Firmware' }), el('dd', { textContent: info.version }),
      el('dt', { textContent: 'Protocol' }), el('dd', { textContent: info.proto }),
      el('dt', { textContent: 'Flash' }), el('dd', { textContent: info.flash ? 'ok' : 'missing (no saving)' }),
      el('dt', { textContent: 'Sample bank' }), el('dd', { textContent: `${(info.bankBytes / 1024).toFixed(0)} KB` }));
    $('#link-pill').textContent = `FM-1 ${info.version}`;
    $('#link-pill').className = 'pill on';
    log(`connected: ${out.name}, firmware ${info.version}`);
    if (info.proto >= 2) live.start(state.link, info.proto);
    if (info.proto < 4) log('The Live panel only mirrors with this firmware: install s1.6 or later to play the FM-1 from here.');
    else { live.stop(); $('#l-status').textContent = `Firmware ${info.version} has no screen mirror: install s1.6 or later.`; }
    setBusy(false);
    renderUsage();
  } catch (e) {
    state.link = null;
    setBusy(false);
    $('#link-pill').textContent = 'FM-1: not connected';
    $('#link-pill').className = 'pill off';
    const msg = e instanceof LinkError ? e.message : e.name === 'SecurityError' ? 'MIDI SysEx access was refused' : (e.message || String(e));
    log('connect: ' + msg + (e instanceof LinkError && /no answer/.test(msg)
      ? ' (is the SLICE64-FM firmware s1.3+ installed? Is the port open in another program: a music software, M-UPGRADE? Pick the SLICE64-FM ports above.)' : ''));
    toast(msg, true);
  }
}
$('#d-connect').onclick = connect;

async function job(what, fn) {
  if (!state.link || state.busy) return;
  setBusy(true);
  try { await fn(); log(what + ': done'); toast(what + ': done'); $('#d-status').textContent = what + ': done'; }
  catch (e) { log(`${what}: ${e.message}`); toast(`${what}: ${e.message}`, true); $('#d-status').textContent = `${what}: failed`; }
  finally { setBusy(false); }
}
const sendSong = () => state.link.writeSong(state.song.b, (d, t) => progress(d, t, 'Song'));
const sendBank = async () => {
  if (state.bank.used > (state.info?.bankBytes || state.bank.capacity)) throw new Error('the samples do not fit: shorten them or lower a rate');
  const { data, entries } = state.bank.image();
  await state.link.writeBank(data, entries, (d, t) => progress(d, t, 'Samples'));
};
$('#d-send-song').onclick = () => job('Send song', sendSong);
$('#d-send-bank').onclick = () => job('Send samples', sendBank);
$('#d-send-all').onclick = () => job('Send song + samples', async () => { await sendBank(); await sendSong(); });
$('#d-read-song').onclick = () => job('Read song', async () => {
  const b = await state.link.readSong(SONG_BYTES, (d, t) => progress(d, t, 'Song'));
  state.song = new Song(b); refreshAll(); changed();
});
$('#d-read-bank').onclick = () => job('Read samples', async () => {
  const info = await state.link.bankInfo();
  const data = info.dataLen ? await state.link.readBank(info.dataLen, (d, t) => progress(d, t, 'Samples')) : new Uint8Array(0);
  state.bank.fromDevice(info, data); renderSamples(); changed();
});
$('#d-save').onclick = () => job('Save on the FM-1', () => state.link.save());
$('#d-play').onclick = () => job('Play', () => state.link.transport(true));
$('#d-stop').onclick = () => job('Stop', () => state.link.transport(false));
// Link test: each kind of request once, timed, so a report says where the replies stop
$('#d-test').onclick = () => job('Test link', async () => {
  const L = state.link, proto = state.info?.proto || 0;
  const step = async (name, fn) => {
    const t0 = performance.now();
    try { const r = await fn(); log(`test ${name}: ok in ${Math.round(performance.now() - t0)} ms${r ? ' — ' + r : ''}`); return true; }
    catch (e) { log(`test ${name}: FAILED after ${Math.round(performance.now() - t0)} ms — ${e.message}`); return false; }
  };
  live.stop();
  log(`test: firmware ${state.info?.version}, protocol ${proto}, ports ${$('#d-out').selectedOptions[0]?.textContent} / ${$('#d-in').selectedOptions[0]?.textContent}`);
  await step('INFO', async () => (await L.info()).version);
  if (proto >= 2) await step('SCREEN (one band)', async () => { const r = await L.screen(true); return r.band === 127 ? 'no band' : `band ${r.band}, ${r.data.length} bytes`; });
  if (proto >= 2) await step('SCREEN again', async () => { const r = await L.screen(false); return r.band === 127 ? 'no band' : `band ${r.band}, ${r.data.length} bytes`; });
  if (proto >= 5) await step('SCREEN_PACK', async () => { const r = await L.screenPack(true); return `${r.sent} bands, ${r.bands.reduce((n, b) => n + b.data.length, 0)} bytes`; });
  if (proto >= 4) await step('INPUT (no-op knob)', async () => { const r = await L.input(2, 0, 0); return `lit ${r.lit.toString(16)}`; });
  await step('INFO again', async () => (await L.info()).version);
  if (proto >= 2) live.start(L, proto);
});

/* --------------------------------------------------------------- start */

try {
  const saved = localStorage.getItem('s64-project');
  if (saved) loadProject(Uint8Array.from(atob(saved), (c) => c.charCodeAt(0)));
} catch { state.song = Song.demo(); state.bank.loadDemo(); }
refreshAll();
setBusy(false);
document.querySelector(`.tabs [data-tab="${location.hash.slice(1)}"]`)?.click();   // #pattern, #samples... open that tab
if (!navigator.requestMIDIAccess) log('This browser has no Web MIDI: use Chrome or Edge to talk to the FM-1. Editing and files work anyway.');
else log('Ready. Plug the FM-1 in USB and press Connect.');
