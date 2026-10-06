// The screen mirror, pixel for pixel: every page, playing, the editor's decoder (live.js) against
// the screen the firmware drew (SLICE64-FM tests/link_host.c "FB").
//   S64_HOST=path/to/fm1_link_host node test/mirror.test.mjs
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Link } from '../js/sysex.js';
import { decodeBand, LCD, BAND_ROWS } from '../js/live.js';

const HOST = process.env.S64_HOST || '../SLICE64-FM/build/Release/fm1_link_host.exe';
const proc = spawn(HOST, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: proc.stdout });
const waiters = [];
const transport = { onFrame: null, send(b) { proc.stdin.write(Buffer.from(b).toString('hex') + '\n'); } };
lines.on('line', (l) => {
  if (l.startsWith('FB ') || l === 'RAN') { waiters.shift()?.(l); return; }
  transport.onFrame?.(Uint8Array.from(Buffer.from(l, 'hex')));
});
const cmd = (c) => new Promise((r) => { waiters.push(r); proc.stdin.write(c + '\n'); });
const link = new Link(transport);
let fails = 0;

const rgba = new Uint8ClampedArray(LCD * LCD * 4);
async function sync(reset) {   // as the Live tab does: SCREEN_PACK until nothing changed
  // (the stand-in draws before every request, so falling meters move each time: let them settle)
  let r = await link.screenPack(reset), n = 0;
  while (r.sent && n++ < 400) {
    for (const b of r.bands) decodeBand(b.data, rgba, b.band * LCD * BAND_ROWS * 4);
    r = await link.screenPack(false);
  }
}
async function compare(what) {
  const fb = (await cmd('FB')).slice(3);
  let bad = 0, first = -1, lossy = 0;
  for (let i = 0; i < LCD * LCD; i++) {
    const c = parseInt(fb.substr(i * 4, 4), 16);
    const r = (c >> 8 & 0xF8) | (c >> 13), g = (c >> 3 & 0xFC) | (c >> 9 & 3), b = (c << 3 & 0xF8) | (c >> 2 & 7);
    const o = i * 4;
    if (rgba[o] !== r || rgba[o + 1] !== g || rgba[o + 2] !== b) { bad++; if (first < 0) first = i; }
  }
  console.log(`${what}: ${bad ? bad + ' pixels differ, first at row ' + Math.floor(first / LCD) + ' col ' + (first % LCD) : 'identical'}`);
  if (bad) fails++;
}

try {
  await link.info();
  await sync(true);
  await compare('TRACK');
  const pages = [['INSTR', 4], ['MIXER LEVELS', 5], ['FX', 0], ['SONG', 9], ['TRACK', 6]];
  for (const [name, btn] of pages) {
    await link.input(0, btn, 1);
    await link.input(0, btn, 0);
    await sync(false);
    await compare(name);
    await cmd('RUN');                     // playing: meters, scopes, the play row move
    await sync(false);
    await compare(name + ' playing');
  }
  // MIXER SENDS: GLO held + OCT+
  await link.input(0, 5, 1); await link.input(0, 13, 1); await link.input(0, 13, 0); await link.input(0, 5, 0);
  await cmd('RUN');
  await sync(false);
  await compare('MIXER SENDS playing');
} catch (e) { fails++; console.log('FAIL', e.message); }
proc.stdin.end();
console.log(fails ? `MIRROR FAILED (${fails})` : 'MIRROR OK');
process.exit(fails ? 1 : 0);
