# video_feedback

Live demo - https://cmdcolin.github.io/webgpu_analog_video_mixer/

Needs a WebGPU-enabled browser

Real-time analog video glitch as **signal-level simulation**, not image filters.
Every frame is encoded to a physically-modeled NTSC composite waveform, degraded
as a 1D signal, and decoded by a deliberately imperfect (but real) decoder — all
in WebGPU compute. Dot crawl, rainbow chroma, ringing, tearing, head-switch bend,
hue drift, and dropouts all emerge from the signal path; nothing is painted on.
Two feedback loops re-enter the chain each frame (camera-at-monitor and a
hardware mixer loop), and a second non-genlocked source can be dirty-mixed in.

## Run

```
pnpm install
pnpm dev
```

- **Sources**: SMPTE bars, multiburst sweep, video/image file, webcam; plus an
  independent source B for the dirty mixer.
- **Presets**: built-ins + 8 save slots (`1`-`8` load, `shift+1`-`8` save).
- **URL params**: `?set=key:value,...`, `?vurl=…`, `?src=sweep|webcam`, `?dbg=1..5`.

The compute passes live in `src/gpu/shaders/*.wgsl` (encode → dirty mix → mixer
loop → chroma extract → color-under → channel → timebase → sync → decode →
present). FIR kernels are windowed-sinc designed from real MHz specs in
`src/signal/filters.ts`.

## Verification harness

```
node scripts/shot.mjs http://localhost:5199/ out.png [waitMs]
```

Drives headed Firefox Nightly, steps frames deterministically, probes pixels,
saves a screenshot. (Headless Chrome can't present WebGPU swap chains here.)

---

100% written with [Fable](https://claude.com/), Anthropic's Claude Fable model.
