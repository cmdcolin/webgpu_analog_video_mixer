# Phosphor / neon colour plan

Goal: the electric, saturated look of a camcorder pointed at a CRT at night —
true-black background, cores that go white-hot, colour that stays vivid at the
clipping point instead of flattening, and trails that shift hue as they die.

## Status

- **Phase 1 — done** (commit `0c141f0`). Hue-preserving `gamutFit()` replaced the
  hard clamp in `decode`; `crtCutoff`/`crtGamma`/`crtSat` beam transfer added to
  `crt_face` (transfer → saturate → gamut-fit → bloom, bloom taps included). All
  three params default to identity, so no existing preset or gallery asset moved.
  Two opt-in presets shipped under a new `Phosphor / CRT` group.
- **Phase 2 — done.** `phosphorMode` (0 sRGB, 1 P22/SMPTE-C, 2 NTSC-1953 on
  Illuminant-C white, 3 long-persistence mono green), `phosphorSkew` (default
  0.7 reproduces the old 1.7/1.0/2.4 exponents exactly), `phosphorDecayMix`
  (peak-hold → additive), phosphor ceiling raised to 0.995. Deviations from the
  spec below: the matrices are applied in *linear* light (pow 2.2 around the
  3×3 — the matrix acts on photons, not gamma-encoded drive); naive additive
  (`outc + tail`) diverges to white on static content, so the shipped additive
  only adds the afterglow beyond what the current drive sustains
  (`max(tail - outc*decay, 0)`); and instead of an rgba16f persist buffer, the
  8-bit store gets half-LSB dither, which also fixes a pre-existing bug where
  trails below ~25/255 quantized to a fixed point and froze as permanent
  ghosts. Presets `round tube` and `green terminal` shipped.
- **Phase 3 — not started.**

The pipeline already has the *light* behaviour (bloom, halation, glow in
`crt_face`) and persistence (in `decode`). What is missing is the tube's
**colour transfer**: today the decoder matrixes YIQ straight to sRGB and hard
clamps. Everything below follows from fixing that.

## Why it currently can't get there

Three specific things, each verified in the source:

1. **`decode.wgsl` ends in `clamp(rgb, 0, 1)`.** A hard clamp on an
   out-of-gamut colour changes its hue — clipping only the channel that
   overflows rotates the colour toward the remaining primaries. Saturated
   content therefore goes *duller and wrong* at exactly the brightness where a
   real tube goes *more electric*.
2. **There is no display-side black cut.** `fbBlack` exists but lives in
   `compose.wgsl`, which is the feedback *camera* path only. Nothing lifts or
   crushes black on the way to the screen, so the background sits at a decoded
   pedestal rather than the true zero the reference images have.
3. **Persistence decay is hard-coded.** `decode` uses
   `vec3f(pow(g, 1.7), g, pow(g, 2.4))`. That ratio *is* the green-tailed trail,
   but it can't be adjusted, and `phosphor` is capped at 0.98, well short of the
   long-persistence look.

## Phase 1 — beam transfer and gamut (the substance)

Add to `crt_face`, at the top, before bloom/halation. That pass is explicitly
the emissive stage, and putting the transfer there means the feedback camera
photographs phosphor light rather than decoder voltages — which is the correct
loop ordering and costs nothing extra.

- **`crtCutoff`** — beam cutoff. Drive below the knee emits nothing. This is
  what makes backgrounds true black, and it is the single biggest contributor to
  the reference look.
- **`crtGamma`** — luminance ≈ drive^γ, γ≈2.4 for a real gun. Expands highlights
  and deepens shadows, so cores bloom and the rest recedes.
- **`crtSat`** — saturation applied around luma, *after* the transfer.
- **Gamut clip by desaturation.** Replace the hard clamp: when a colour exceeds
  the cube, pull it toward its own luma until it fits, preserving hue. Do this
  in `decode` (where the clamp is) and let `crt_face` work in headroom.

Order matters: transfer → saturate → gamut-fit → bloom/halation. Saturating
after the gamma is what gives vivid mids without posterizing.

## Phase 2 — phosphor identity

- **P22 primaries.** A 3×3 from sRGB primaries to P22's actual chromaticities.
  P22 green is markedly more yellow-green and its blue more violet than sRGB, so
  this alone shifts the whole image toward the CRT palette. Ship it as a
  `phosphorMode` select (sRGB / P22 / long-persistence green) rather than a
  slider — these are discrete tube types, not a continuum.
- **Expose the persistence skew.** Turn the hard-coded exponents into
  `phosphorSkew` (R/B decay relative to G) and raise the `phosphor` ceiling
  toward 0.995. Blue-white streak with a green tail is exactly this ratio held
  longer.
- **Consider decay vs peak-hold.** Persistence currently uses `max()`, which
  holds a hard edge. Real phosphor decays exponentially and *adds*. A mix
  control between peak-hold and additive decay would give softer, more
  photographic trails; peak-hold should stay available since it is what makes
  the current strobe presets read.

### Handoff — where each piece lands

All three live in `decode.wgsl` around the persistence block
(`decode.wgsl:176-188`), plus the standard param wiring (`PARAM_DEFS` in
`prelude.ts` → `DEFAULT_CONTROLS` + `uniformValues()` in `pipeline.ts` →
`GROUPS` in `controls.ts`; see `agent-docs/ARCHITECTURE.md` "Adding a control").

- **`phosphorMode` (P22 matrix).** A discrete select, not a slider — follow the
  existing `combMode`/`bendShape` pattern (an `f32` compared against thresholds,
  e.g. `P.phosphorMode < 0.5`). Apply the 3×3 to `rgb` *after* the YIQ→sRGB
  matrix (`decode.wgsl:171-175`) and *before* `gamutFit`, so the fit still
  guarantees a valid cube. Default 0 = sRGB identity → no preset moves. Compute
  the sRGB→P22 matrix on the CPU from P22 chromaticities and pass it in (a param
  matrix, or hardcode a `mat3x3f` const in the shader keyed by mode). The UI has
  no select control yet — either add one to `SliderDef`/the controls renderer, or
  interim-ship it as a stepped slider (min 0, max 2, step 1) to avoid new UI work.
- **`phosphorSkew`.** Replace the hard-coded `vec3f(pow(g,1.7), g, pow(g,2.4))`
  (`decode.wgsl:184`) with skew-driven exponents, e.g.
  `vec3f(pow(g, 1.0+P.phosphorSkew), g, pow(g, 1.0+2*P.phosphorSkew))`. Pick the
  default so it reproduces today's 1.7/1.0/2.4 ratio exactly (skew ≈ 0.7) — that
  keeps `strobe trails` and every other persistence preset identical. Raise the
  `min(P.phosphor, 0.98)` ceiling (`decode.wgsl:183`) toward 0.995 and bump the
  `phosphor` slider max in `controls.ts` to match.
- **Peak-hold vs additive decay.** Today: `outc = max(outc, prev*decay)`
  (`decode.wgsl:185`). Add a `phosphorDecayMix` that lerps between that `max()`
  and an additive `outc + prev*decay` (clamp/gamut-fit the sum). Default 0 =
  pure peak-hold → strobe presets unchanged.

Risk: the persist buffer is `rgba8unorm` (`persistBuf`), so long additive trails
will band. If they look stepped, that buffer's precision is the cause — a
possible phase-1.5 (rgba16f) rather than a phase-2 blocker.

Verify with `?preset=` + `scripts/shot.mjs` (Firefox Nightly) before/after across
the preset list; with all new params at their defaults the captures must be
byte-identical to Phase 1.

## Phase 3 — polish

- **Halation keyed to beam current.** Glass scatter blooms disproportionately on
  peak whites; keying the halo radius (not just its amplitude) off local luma
  would read more like real glass than today's fixed-radius ring.
- **Per-channel bloom radius.** Different phosphors have different grain, so the
  blue core spreads slightly less than the red. Small, but it kills the
  "gaussian filter" tell.

## Sequencing and risk

Phase 1 alone probably gets 80% of the reference look and is contained to two
shaders plus params. Phase 2 changes the colour of *every existing preset*,
which is why it should be a mode select defaulting to current behaviour rather
than an always-on matrix — otherwise every gallery image and clip in `docs/` and
`clips/` silently changes and would need regenerating.

Cheap to verify: the existing `?preset=` URL plus `scripts/shot.mjs` can capture
before/after for the whole preset list, and the `dbgView` hooks in `decode`
(modes 3/4/5 dump luma, chroma, and burst state) already isolate the stages if a
colour shift needs debugging.
