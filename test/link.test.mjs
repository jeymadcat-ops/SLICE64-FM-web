// The editor's protocol client against the real firmware link code on a simulated flash
// (SLICE64-FM tests/link_host.c, built as fm1_link_host).
//   S64_HOST=path/to/fm1_link_host node test/link.test.mjs
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Link } from '../js/sysex.js';
import { Song } from '../js/song.js';
import { Bank } from '../js/bank.js';
import { SONG_BYTES } from '../js/data.js';
import { decodeBand, BANDS, LCD, BAND_ROWS } from '../js/live.js';

const HOST = process.env.S64_HOST || '../SLICE64-FM/build/Release/fm1_link_host.exe';
let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } };

const proc = spawn(HOST, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: proc.stdout });
let booted = null;
const transport = {
  onFrame: null,
  send(bytes) { proc.stdin.write(Buffer.from(bytes).toString('hex').toUpperCase() + '\n'); },
};
lines.on('line', (l) => {
  if (l === 'BOOTED') { booted?.(); return; }
  transport.onFrame?.(Uint8Array.from(Buffer.from(l, 'hex')));
});
const powerCycle = () => new Promise((r) => { booted = r; proc.stdin.write('BOOT\n'); });

const link = new Link(transport);
try {
  const info = await link.info();
  check(info.proto >= 2 && info.flash && info.songBytes === SONG_BYTES && info.samples === 8 && info.version === 'host-sim', 'INFO ' + JSON.stringify(info));

  // read the device's song, change it in the editor model, send it, read it back
  const dev = new Song(await link.readSong(SONG_BYTES));
  check(dev.numOrders > 0 && dev.bpm >= 40, 'read song');
  const s = Song.demo();
  s.name = 'from the web';
  s.bpm = 174;
  s.setCell(3, 5, 2, { note: 49, instr: 4, fx: 'R'.charCodeAt(0), param: 3 });
  s.loadPreset(7, 2);
  let last = 0;
  await link.writeSong(s.b, (d) => { last = d; });
  check(last === SONG_BYTES, 'write progress');
  const back = await link.readSong(SONG_BYTES);
  check(Buffer.compare(Buffer.from(back), Buffer.from(s.b)) === 0, 'song round trip');

  // the sample bank: the demo break
  const bank = new Bank();
  bank.loadDemo();
  bank.slots[3].name = 'COPY';
  bank.slots[3].rate = 16000;
  bank.slots[3].data = bank.slots[0].data.slice(0, 5000);
  const { data, entries } = bank.image();
  await link.writeBank(data, entries);
  const bi = await link.bankInfo();
  check(bi.dataLen === data.length && bi.slots[0].name === 'JUNGLE' && bi.slots[0].len === bank.slots[0].data.length && bi.slots[0].rate === 32000, 'bank info slot 1');
  check(bi.slots[3].name === 'COPY' && bi.slots[3].rate === 16000 && bi.slots[3].len === 5000 && bi.slots[1].len === 0, 'bank info slot 4');
  const raw = await link.readBank(bi.dataLen);
  check(Buffer.compare(Buffer.from(raw), Buffer.from(data)) === 0, 'bank round trip');
  const b2 = new Bank();
  b2.fromDevice(bi, raw);
  check(b2.slots[3].data.length === 5000 && b2.slots[0].name === 'JUNGLE', 'bank back into the editor');

  // the song and the samples survive a power cycle
  await powerCycle();
  check(Buffer.compare(Buffer.from(await link.readSong(SONG_BYTES)), Buffer.from(s.b)) === 0, 'song after power cycle');
  check((await link.bankInfo()).slots[3].len === 5000, 'bank after power cycle');

  // the screen mirror: every band once, then nothing while the screen stays
  {
    const rgba = new Uint8ClampedArray(LCD * LCD * 4), seen = new Set();
    let r = await link.screen(true), polls = 0, bytes = 0;
    const t0 = Date.now();
    while (r.band !== 127 && polls < 100) {
      decodeBand(r.data, rgba, r.band * LCD * BAND_ROWS * 4);
      seen.add(r.band); bytes += r.data.length; polls++;
      r = await link.screen(false);
    }
    check(seen.size === BANDS, 'mirror: all bands (' + seen.size + ')');
    check(rgba.some((v, i) => i % 4 !== 3 && v > 40), 'mirror: something drawn');
    check(r.glow === 0x3FFF, 'mirror: the lights');
    console.log(`mirror: a full screen in ${polls} bands, ${(bytes / 1024).toFixed(1)} KB, ${Date.now() - t0} ms on the stand-in`);
  }

  // protocol 3: SCREEN_ALL, the whole screen in a few requests
  {
    const rgba = new Uint8ClampedArray(LCD * LCD * 4), seen = new Set();
    let calls = 0, r = await link.screenAll(true);
    for (;;) {
      calls++;
      for (const b of r.bands) { decodeBand(b.data, rgba, b.band * LCD * BAND_ROWS * 4); seen.add(b.band); }
      if (!r.sent || calls > 40) break;
      r = await link.screenAll(false);
    }
    check(seen.size === BANDS && r.sent === 0, 'screenAll: every band (' + seen.size + ')');
    console.log(`screenAll: a full screen in ${calls - 1} requests`);
  }

  // SAVE stores what the device has now
  check(await link.transport(true) === true, 'play');
  check(await link.transport(false) === false, 'stop');
  await link.save();
} catch (e) {
  fails++;
  console.log('FAIL', e.message);
}
proc.stdin.end();
console.log(fails ? `WEB LINK FAILED (${fails})` : 'WEB LINK OK');
process.exit(fails ? 1 : 0);
