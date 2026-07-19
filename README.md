# Phosphene

_(phosphene — the light you see without light; here, glitch that emerges from
the physics, not from a filter.)_

Live demo - https://cmdcolin.github.io/phosphene/

[![Deploy](https://github.com/cmdcolin/phosphene/actions/workflows/deploy.yml/badge.svg)](https://github.com/cmdcolin/phosphene/actions/workflows/deploy.yml)

Needs a WebGPU-enabled browser

Real-time analog video glitch as **signal-level simulation**, not image filters.
Every frame is encoded to a physically-modeled NTSC composite waveform, degraded
as a 1D signal, and decoded by a deliberately imperfect (but real) decoder — all
in WebGPU compute. Dot crawl, rainbow chroma, ringing, tearing, head-switch
bend, hue drift, and dropouts all emerge from the signal path; nothing is
painted on. Two feedback loops re-enter the chain each frame (camera-at-monitor
and a hardware mixer loop), and a second non-genlocked source can be dirty-mixed
in.

## Run

```
pnpm install
pnpm dev
```

- **Sources**: SMPTE bars, multiburst sweep, video/image file, webcam; plus an
  independent source B for the dirty mixer.
- **Presets**: built-ins + 8 save slots (`1`-`8` load, `shift+1`-`8` save).
- **URL params**: `?set=key:value,...`, `?vurl=…`, `?src=sweep|webcam`,
  `?dbg=1..5`, `?prof` (per-pass GPU timings in the console, needs
  timestamp-query support).

The compute passes live in `src/gpu/shaders/*.wgsl` (encode → dirty mix → mixer
loop → [chroma extract → color-under → channel → timebase] × dub generations →
sync → decode → present). FIR kernels are windowed-sinc designed from real MHz
specs in `src/signal/filters.ts`.

## Verification harness

```
node scripts/shot.mjs http://localhost:5199/ out.png [waitMs]
```

Drives headed Firefox Nightly, steps frames deterministically, probes pixels,
saves a screenshot. (Headless Chrome can't present WebGPU swap chains here.)

---

This project was kicked off with [Fable](https://claude.com/). it really nailed
the crazy complexity of the task. I had previous asked opus and it was not
nearly this good, though it targetted python, but it really just didn't
understand the 'signal level' ideas for making the glitches
