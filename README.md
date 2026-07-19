# video_feedback

Real-time analog video glitch as **signal-level simulation**, not image filters.
Every frame is encoded into a physically-modeled NTSC composite waveform,
degraded as a 1D signal, and decoded by a deliberately imperfect (but real)
decoder — all in WebGPU compute at 60fps. Artifacts (dot crawl, rainbow chroma,
ringing, tearing, head-switch bend, hue drift, color killer dropout) are
emergent from the signal path; nothing is painted on.

Two feedback loops re-enter the analog chain every frame: camera-at-monitor
(lens + sensor model) and a hardware mixer loop (the composite output
crossfaded electrically back into an input bus). A second, non-genlocked
source can be summed or ring-modulated in at the composite level (dirty
mixing). VJ-style sliders in physical units (MHz, IRE, ns, degrees, Hz).

## Run

```
pnpm install
pnpm dev
```

Open in a WebGPU browser (Chrome, or Firefox Nightly with `dom.webgpu.enabled`).

- **Sources**: SMPTE bars, multiburst sweep (bandwidth validation), video/image file, webcam;
  independent source B (bars/sweep/file) for the dirty mixer.
- **Presets**: built-ins + 8 save slots (keys `1`-`8` load, `shift+1`-`8` save).
- URL params for automation: `?set=key:value,...` (control keys from
  `src/gpu/pipeline.ts`), `?vurl=/test.mp4`, `?src=sweep|webcam`,
  `?dbg=1..5` (stage debug views), `&debug` (console diagnostics).

## The signal path

Fixed physical raster: 910 samples/line × 525 lines at 4×fsc (14.318 MHz),
IRE levels, real sync tips + 9-cycle colorburst in the buffer. Compute passes:

| pass | file | models |
|---|---|---|
| compose | `compose.wgsl` | camera-at-monitor feedback (affine reframe, lens defocus + vignette, sensor black cut + s-curve) + source mix |
| encode | `encode_yuv.wgsl`, `encode_composite.wgsl` | RGB→YUV, FIR-bandlimited quadrature modulation onto the subcarrier, sync/burst generation |
| dirty mix | `mix_b.wgsl` | second non-genlocked NTSC generator (slipping/skewed line timing, rolling frame, detuned subcarrier) summed or ring-modulated into the composite, through a B-bus proc amp (hue/gain/invert) and pattern-generator wipes |
| mixer loop | `fb_composite.wgsl`, `store_prev.wgsl` | last frame's degraded composite crossfaded back in electrically; self luma key, cable-delay hue spin, inverting gain, rail clipping; frame store with strobe hold and peak-hold trails |
| chroma extract | `chroma_extract.wgsl` | bandpass at fsc |
| color-under | `under_down.wgsl` | VHS heterodyne down to 629 kHz + lowpass |
| channel | `channel.wgsl` | luma bandwidth/peaking FIR, color-under playback (phase-jittered up-conversion), multipath ghost, noise, hum, 4.5 MHz sound-carrier leak, RF dropouts, head-switch noise |
| timebase | `timebase.wgsl` | wow/flutter random walk + head-switch step (no TBC) |
| sync | `sync.wgsl` | sync separator + flywheel PLL + gated AGC (sync-tip depth -> IF gain, so the picture pumps); tearing/rolling emerge when sync is unfindable |
| burst gate | `line_analyze.wgsl` | per-line burst phase/amplitude on the degraded signal |
| decode | `decode.wgsl` | trap/comb Y/C separation, synchronous demod, burst-locked hue + ACC + color killer |
| present | `present.wgsl` | 4:3 letterbox, gaussian beam-spot scanline profile |

All FIR kernels are windowed-sinc designed from real MHz specs in
`src/signal/filters.ts`. Per-line continuous processes (timebase, color-under
phase) advance on the CPU in `src/signal/linestate.ts`.

## Verification harness

```
node scripts/shot.mjs http://localhost:5199/ out.png [waitMs]
```

Drives headed Firefox Nightly (WebGPU), steps frames deterministically,
probes canvas pixels, saves a screenshot. Headless Chrome cannot present
WebGPU swap chains on this platform.
