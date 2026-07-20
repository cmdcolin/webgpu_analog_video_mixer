# Phosphene architecture

Orientation for someone (or something) about to change this codebase. It covers
the shape of the system and the invariants that are easy to violate, not an
inventory of every file.

## The premise

Phosphene simulates the NTSC signal path, not the *look* of one. There is no
"VHS filter". A picture is encoded to a real composite waveform on a fixed
raster, damaged in the ways real hardware damages a waveform, then decoded by a
model of a TV that has to find sync in whatever it is handed. Dot crawl, rainbow
fringing, tearing, rolling and hue drift are **emergent** — nobody draws them.

That premise is the main design constraint: when adding an effect, prefer
modelling the mechanism that causes the artifact over drawing the artifact. The
payoff is that mechanisms interact for free, which is where the interesting
output comes from.

## The raster

Everything hangs off `src/signal/constants.ts`:

| quantity           | value                             |
| ------------------ | --------------------------------- |
| sample rate        | 4 × F_SC = 14.31818 MHz           |
| samples per line   | 910 (= 227.5 subcarrier cycles)   |
| lines per frame    | 525                               |
| active picture     | 754 × 480, starting at line 22    |
| line structure     | 67-sample sync tip, burst at 78   |

The composite signal lives in flat `array<f32>` buffers of 910 × 525 samples in
IRE units (sync −40, blank 0, black 7.5, white 100). Sample index `n = row * 910
+ s`. Parameters are authored in **physical units** (µs, Hz, IRE) and converted
to samples at the uniform-packing boundary — keep it that way.

The model is 525 lines per frame at 60 fps, i.e. progressive. Real NTSC is
interlaced at *field* rate with a half-line offset, which is why vertical roll
currently steps a whole frame at a time. That is the largest remaining
authenticity gap.

## Pass order

One frame, driven by `Engine.render()` in `src/gpu/pipeline.ts`:

```
prePasses    compose → encodeYuv → encodeComposite → [encodeYuvB → mixB] → [fbComposite]
loopPasses   chromaExtract → [underDown] → channel → timebase     (× dubGens, ≤ 4)
postPasses   syncMeasure → sync → lineAnalyze → decode → crtFace → [storePrev]
present      render pass to the swap chain
```

Bracketed passes are gated by a `when()` predicate on the controls, so an idle
feature costs nothing. `loopPasses` runs once per tape-dub generation, with
per-generation params copied over the live buffers in between so each pass gets
its own noise and time-base walk.

The split matters: **encode** builds the waveform, **channel/timebase** damage
it, **sync/decode** is the receiver trying to make sense of the damage. An
effect belongs in the stage that physically causes it.

## The three domains

The single most important distinction in this codebase, and the easiest to get
wrong. A horizontal displacement can come from three places, and they are *not*
interchangeable:

1. **Signal domain** (`timebase`, `channel`) — the waveform itself is resampled.
   The burst moves with the picture, so decoder hue wobbles too. This is tape
   time-base error.
2. **Sync domain** (`sync` → `timing[]`) — the receiver mis-locates the line
   start. The burst gate is keyed off the same `timing[]`, so it follows, and a
   large enough error mistimes the gate and throws colour off. This is hold /
   flagging.
3. **Deflection domain** (`bendAt`, HV sag, audio bend, all inside `decode`) —
   the tube's own scan is bent, downstream of decoding. Hue must **not** move,
   and these are indexed by *raster line*, not source row, so a rolling picture
   slides through a bend that stays put on the glass.

Before adding a displacement, decide which domain causes it. Routing a geometry
fault through `timing[]` will spin hue that should have stayed put.

## Buffer layouts worth knowing

- **`timingBuf`** (`(LINES * 2 + 3)` floats) — `[0..524]` per-line horizontal
  offset; `[525]` vertical oscillator phase, signed and fractional; `[526]` PLL
  state; `[527]` AGC gain; `[SAG_BASE..]` normalized deflection sag per raster
  line. Indices 525–527 are persistent across frames; treat them as state.
- **`lineParamsBuf`** — one `vec4f` per line from `LineState`:
  `(tbOffsetSamples, underBasePhase, underJitterPhase, seed)`. All four slots
  are taken; a new per-line CPU quantity needs its own buffer.
- **`syncMeasureBuf`** — one `vec4f` per line from `sync_measure`:
  `(sync edge or −1000, sync depth, mean beam load, broad-pulse flag)`.
- **`audioBuf`** — one float per line, the audio waveform at line rate.
- **`persistBuf`** — previous displayed frame, packed `rgba8`, for phosphor.

## Params are generated, not hand-written

`PARAM_DEFS` in `src/gpu/prelude.ts` is the single source of truth for the
uniform struct: **field order there is the GPU memory layout**. It generates both
the WGSL `Params` struct and a typed `Record` that `packParams` consumes. Adding
a param to `PARAM_DEFS` without supplying it in `Engine.uniformValues()` is a
TypeScript error, by design — that is the guard against a silently-zero uniform.

Adding a control end to end:

1. `PARAM_DEFS` (prelude) — GPU-side field.
2. `DEFAULT_CONTROLS` (pipeline) — user-facing value, in physical units.
3. `uniformValues()` (pipeline) — convert units, fold in any CPU state.
4. `GROUPS` (`src/ui/controls.ts`) — slider; every control has one.
5. Optionally a preset in `src/ui/presets.ts`.

CPU-side per-frame state (`LineState`, `MixState`, `AudioState`) lives in
`src/signal/` and is either uploaded as a buffer or folded into uniforms.

## Performance shape

Almost everything is comfortably parallel. Two exceptions:

- **`sync.wgsl` is `workgroup_size(1,1,1)`** — a single thread running two
  525-iteration loops (the PLL flywheel and the HV sag). It must be serial: each
  line's value depends on the previous line's. It is latency on one thread
  rather than GPU throughput, and it measures fine at 60 fps, but it is the one
  pass that cannot scale. Another per-line recurrence should be a parallel
  prefix-scan instead of a third loop here.
- **`decode` stages a shared tile per row.** A workgroup covers 64 pixels of one
  raster row and stages a contiguous span with a 32-sample halo, so the demod FIR
  reads workgroup memory. Consequence: horizontal offsets must be **row-uniform**.
  Per-pixel horizontal scaling (H size, linearity, pincushion) would read outside
  the halo and needs the staging restructured first.

## The React layer

React only ever configures the engine — it never renders a frame. The render
loop lives in `useEngine` and writes to the canvas directly, so live per-frame
state (fps stats, resolution) reaches the overlays as **mutable refs read during
render**, rather than re-rendering React at 60 fps.

**React Compiler is on** (`vite.config.ts`, via `reactCompilerPreset` and
`@rolldown/plugin-babel`). Don't add `useMemo`/`useCallback` — memoization is
the compiler's job. Two consequences worth knowing:

- **Four things don't compile:** `App`, `Stage`, `InputSection`, `useEngine` —
  the ref-during-render pattern above is exactly what the compiler refuses.
  This is harmless in itself: a bail-out means the compiler leaves that code
  exactly as written. It's why `react-hooks/refs` is off in
  `eslint.config.js`; the rest of eslint-plugin-react-hooks' recommended set is
  on and reports bail-outs.
- **What is load-bearing is that the *producer* of a callback compiles.** `App`
  holds `writeControl` from `useMidi` in an effect dep array; if that closure
  got a fresh identity per render the effect would re-fire constantly and
  `midi.setExternal` would reset soft-takeover every render, so a physical knob
  could never hold its catch. Since the hand-written `useCallback` is gone, the
  only thing keeping it stable is `useMidi` compiling. Note the consumer's own
  status is irrelevant — a compiled consumer still re-fires on a changed
  identity. Reshape `useMidi`/`useCapture` into something the compiler bails on
  and this breaks silently: no type error, no lint error.

To check what compiled, build unminified and look for the memo-cache preamble:

```sh
pnpm exec vite build --minify false
grep -n "import_compiler_runtime.c)(" dist/assets/*.js   # one per compiled fn
```

## Testing

- `pnpm test` — `src/gpu/shaders.test.ts` prepends the real prelude to every
  `.wgsl` and validates it with **naga**. WGSL is otherwise only compiled inside
  the browser, so a typo would survive until runtime. Naga is optional locally,
  enforced under CI. Plus unit tests for the pure DSP/envelope helpers.
- **Visual verification needs Firefox Nightly on Linux**, not Chrome — see
  `CLAUDE.md`. Chrome's ANGLE/Vulkan backend reports spurious texture-allocation
  errors that are driver artifacts. `scripts/shot.mjs` launches it with the right
  prefs; model new harnesses on it.
- The app exposes the engine as `window.vf`, and `?iurl=`, `?iurlb=`, `?preset=`
  and `?set=` configure a session entirely from the URL — so a harness never has
  to click the UI. `?dbg=` selects debug views (2 waveform, 3 luma, 4 chroma,
  5 burst state) which are the fastest way to isolate a stage.
- Occluded windows throttle `rAF`; call `window.vf.step()` to advance frames
  deterministically. Note that stepping in a tight loop makes the on-screen fps
  readout meaningless — measure perf with `rAF` running normally.

## Conventions

`CLAUDE.md` has the full set; the ones that bite hardest here:

- Never `git stash` — multiple agents share this worktree.
- Don't create feature branches unless asked.
- Debug by adding logging and proving a hypothesis, not by patching symptoms.
- Comments explain *why* — the physical mechanism being modelled — not *what*.
