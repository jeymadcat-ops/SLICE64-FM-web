// The song model: the ARP TABLES (firmware s6.0 on) and the rest of the layout it sits behind.
import { Song } from '../js/song.js';
import { SONG_BYTES, OFF_INSARP, OFF_ATAB, ATAB_BYTES } from '../js/data.js';

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL', what); } };

const s = new Song();
check(s.b.length === SONG_BYTES, 'the song has the firmware\'s size');
// a new song's eight tables: major first
const t0 = s.atab(0);
check(t0.len === 4 && t0.steps[2] === 7 && t0.speed === 2, 'table 1 is a major chord');
check(s.instrArp(5) === 0, 'no instrument has a table at first');
s.setInstrArp(5, 3);
check(s.b[OFF_INSARP + 5] === 3 && s.instrArp(5) === 3, 'an instrument\'s table number');
s.b[OFF_INSARP + 6] = 99;
check(s.instrArp(6) === 0, 'a bad number reads as none');

// writing a table: negative steps are two's complement bytes
s.setAtab(4, { len: 3, speed: 5, loop: 1, steps: [0, -5, 9] });
check(s.b[OFF_ATAB + 4 * ATAB_BYTES] === 3 && s.b[OFF_ATAB + 4 * ATAB_BYTES + 4] === 251, 'table 5 as bytes');
const t4 = s.atab(4);
check(t4.len === 3 && t4.speed === 5 && t4.loop === 1 && t4.steps[1] === -5 && t4.steps[2] === 9 && t4.steps[15] === 0, 'table 5 read back');
s.setAtab(4, { len: 2, speed: 99, loop: 9, steps: [100, -100] });
const c4 = s.atab(4);
check(c4.speed === 16 && c4.loop === 1 && c4.steps[0] === 48 && c4.steps[1] === -48, 'clamped like the firmware');

// the random table keeps the length, speed and loop, draws every step
s.setAtab(2, { len: 12, speed: 4, loop: 6, steps: [] });
s.randomAtab(2, true);
const r2 = s.atab(2);
check(r2.len === 12 && r2.speed === 4 && r2.loop === 6 && r2.steps[0] === 0, 'the random table keeps len, speed and loop');
check(r2.steps.slice(1, 12).some((v) => v !== 0), 'and draws its whole length');
s.randomAtab(2, false);
const n2 = s.atab(2);
check(n2.len >= 3 && n2.len <= 8 && n2.speed >= 1 && n2.speed <= 3, 'a new table gets a new length and speed');

// the engine of an instrument and its preset do not touch the table number
s.setEngine(5, 1);
check(s.instrArp(5) === 3, 'changing the engine keeps the table');
s.loadPreset(5, 0);
check(s.instrArp(5) === 3, 'loading a preset keeps the table');

console.log(fails ? `SONG FAILED (${fails})` : 'SONG OK');
process.exit(fails ? 1 : 0);
