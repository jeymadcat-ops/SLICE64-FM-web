# SLICE64-FM Editor

A web editor for **SLICE64-FM**, the 4-track SID / FM / sampler tracker firmware for the
M-VAVE FM-1. Edit patterns, the song order, the mixer, instruments and samples in the
browser, then send them to the FM-1 over USB.

**Open it:** https://jeymadcat-ops.github.io/SLICE64-FM-web/

## What you need

- An FM-1 running the SLICE64-FM firmware **s1.3 or later** (earlier versions have no link).
- **Chrome or Edge** (desktop): the page talks to the FM-1 with Web MIDI SysEx. Allow
  MIDI access when the browser asks.
- A USB cable. No driver, no install.

## What it does

| Tab | |
|---|---|
| Device | Connect, send the song and / or the samples, read them back, save on the FM-1, play / stop |
| Song | Name, BPM, speed, the order list, the 4-track mixer (volume, mute, drive, distortion, sends), delay and reverb |
| Pattern | The 32 patterns, tracker-style keyboard entry (FT2 piano layout on physical keys, QWERTY or AZERTY), copy / paste / clear / transpose |
| Instruments | The 32 instruments, every engine parameter, the 39 factory presets |
| Samples | 8 slots: drop any audio file, trim, pick the rate (8 to 32 kHz), normalize, preview; the bank is 8-bit in the FM-1's flash (about 252 KB) |

A song sent to the FM-1 is written to its flash and comes back at power-on. **Save file**
writes a `.s64p` project (song + samples); the page also keeps your work in the browser.

## Files

- `index.html`, `css/`, `js/app.js`: the page
- `js/sysex.js`: the SysEx protocol (frames `F0 7D 53 36 cmd … F7`)
- `js/song.js`: the song byte layout (34 319 bytes, version 1)
- `js/bank.js`: samples, the bank image, `.s64p` files
- `js/data.js`: generated from the SLICE64-FM engine (presets, defaults, demo): do not edit
- `test/link.test.mjs`: the protocol against the firmware's own link code on a simulated flash
  (`S64_HOST=…/fm1_link_host node test/link.test.mjs`)

No build step: plain ES modules. To try it locally, serve the folder
(`python -m http.server`) and open `http://localhost:8000` (Web MIDI needs `localhost` or HTTPS).
