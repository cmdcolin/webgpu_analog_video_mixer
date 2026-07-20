// Shared WGSL prelude prepended to every shader, and the matching uniform
// packer. PARAM_DEFS is the single source of truth for the Params struct:
// field order here IS the GPU memory layout.

import {
  ACTIVE_HEIGHT,
  ACTIVE_START,
  ACTIVE_TOP,
  ACTIVE_WIDTH,
  BURST_AMP_IRE,
  BURST_LEN,
  BURST_START,
  HEAD_SWITCH_LINE,
  IRE_BLACK,
  IRE_BLANK,
  IRE_SYNC,
  IRE_VIDEO_RANGE,
  LINES,
  SAMPLES_PER_LINE,
  SYNC_LEN,
  VSYNC_FIRST,
  VSYNC_LAST,
} from '../signal/constants'
import {
  FILTER_STRIDE,
  SEC_CHROMA_BP,
  SEC_DEMOD,
  SEC_ENC_CHROMA,
  SEC_LUMA,
  SEC_UNDER,
  TAPS,
} from '../signal/filters'
import { DOWN_PER_SAMPLE } from '../signal/linestate'

export const PARAM_DEFS = [
  ['frame', 'u32'],
  ['gen', 'u32'], // dub generation index: decorrelates noise/dropout seeds per pass
  ['canvasW', 'f32'],
  ['canvasH', 'f32'],
  ['srcAspect', 'f32'],
  ['srcNoise', 'f32'], // GPU-generated source A: 0 texture, 1 TV static, 2 VHS blank-tape static
  ['invert', 'f32'], // source A polarity flip: negate composite (0.5 = solarized)
  ['deint', 'f32'], // bob-deinterlace source A: rebuild from one field, killing capture combing
  // dirty mixer: source B is a second, non-genlocked composite signal
  ['bGain', 'f32'], // additive mix gain
  ['bRing', 'f32'], // ring modulation amount
  ['bRowOff', 'f32'], // vertical slip, lines (accumulated)
  ['bShift0', 'f32'], // horizontal slip, samples (accumulated)
  ['bShiftLine', 'f32'], // horizontal skew per line (line-frequency offset)
  ['bPhase0', 'f32'], // subcarrier detune phase base (accumulated)
  ['bPhaseLine', 'f32'], // subcarrier detune phase per line
  ['bHue', 'f32'], // B proc-amp hue trim, radians
  ['bVidGain', 'f32'], // B proc-amp video gain
  ['bInv', 'f32'], // B video inversion amount (0.5 = solarized midpoint)
  ['wipeMode', 'f32'], // 0 off, 1 h, 2 v, 3 box, 4 diamond
  ['wipePos', 'f32'], // wipe position incl. auto-sweep (accumulated)
  ['wipeSoft', 'f32'], // wipe edge softness
  // picture-in-picture: source B squeezed into a positionable window, re-encoded
  // genlocked to the house raster (a DVE/switcher inset — dot-crawls, no beat)
  ['pipMix', 'f32'], // inset key over program, 0 off
  ['pipX', 'f32'], // window center X, active-picture UV
  ['pipY', 'f32'], // window center Y, active-picture UV
  ['pipW', 'f32'], // window width, active-picture UV
  ['pipH', 'f32'], // window height, active-picture UV
  ['pipBorder', 'f32'], // matte border thickness, active-picture UV
  ['pipSoft', 'f32'], // window edge softness, active-picture UV
  ['pipKey', 'f32'], // inset luma key amount, negative inverts polarity
  ['pipKeyLevel', 'f32'], // inset luma key slice, 0..1
  ['pipKeySoft', 'f32'], // inset luma key edge softness, luma units
  // VHS tracking error: a mistracked head produces a noise band that tears and
  // bends the picture at an adjustable height (the "tracking" knob).
  ['trackAmt', 'f32'], // severity, 0 locked
  ['trackPos', 'f32'], // band vertical position, 0..1
  // decoder
  ['combMode', 'f32'], // 0 chroma trap, 1 two-line comb, 2 three-line comb
  ['hHold', 'f32'], // sync PLL gain (horizontal hold)
  ['vHold', 'f32'], // vertical oscillator pull-in gain (vertical hold lock strength)
  ['vRollRate', 'f32'], // free-run roll velocity, lines/frame, from the v-osc detune
  ['syncBend', 'f32'], // PLL kick at the vertical seam, samples (flagging)
  // deflection geometry: tube-side scan distortion, downstream of the decoder,
  // so it bends the picture without moving the burst gate or spinning hue
  ['bendAmt', 'f32'], // horizontal displacement amplitude, samples
  ['bendShape', 'f32'], // 0 flag, 1 skew, 2 bow, 3 sine
  ['bendPeriod', 'f32'], // flag decay constant / sine period, screen lines
  ['hvSag', 'f32'], // beam-current deflection sag amplitude, samples
  ['hvRing', 'f32'], // supply damping: 0 smooth droop .. 1 ringing / chaotic
  ['hRate', 'f32'], // horizontal oscillator free-run drift, samples/line
  // audio patched into the deflection, one sample per line
  ['audioBend', 'f32'], // direct horizontal displacement, samples
  ['audioLoad', 'f32'], // audio driven into the HV tank alongside beam current
  ['audioIre', 'f32'], // audio patched straight into the composite line, IRE per unit
  ['chromaGain', 'f32'],
  ['burstLock', 'f32'], // 0..1: how much the decoder trusts the (degraded) burst
  ['scDetunePhase', 'f32'], // bent-crystal demod LO phase error at frame start, radians (accumulated)
  ['scDetunePerSample', 'f32'], // LO phase error growth per sample, radians
  ['killThresh', 'f32'], // IRE of burst amplitude below which color killer engages
  ['svideoBleed', 'f32'], // Y/C cross-wire: chroma bled into luma (0.5 defeats the trap)
  ['chromaCoarse', 'f32'], // chroma demod decimation factor; >1 lerps between lattice points (CUE rainbows)
  // channel / tape
  ['soundIre', 'f32'], // 4.5 MHz sound carrier leaking past the trap, IRE
  ['agc', 'f32'], // receiver AGC action, 0 fixed gain .. 1 full
  ['noiseSigma', 'f32'], // additive noise, IRE rms
  ['ghostDelay', 'f32'], // samples
  ['ghostGain', 'f32'],
  ['humAmp', 'f32'], // IRE
  ['colorUnderMix', 'f32'], // 0 direct chroma .. 1 full VHS color-under path
  ['dropoutRate', 'f32'], // expected dropout events per frame
  ['dropoutLen', 'f32'], // mean dropout length, samples
  ['headSwitchNoise', 'f32'], // 0..1
  ['polarityFlip', 'f32'], // hard signal/ground swap: negate whole composite incl. sync
  ['termination', 'f32'], // cable termination fault: <0 double-terminated (dim), >0 open (hot + ringing)
  ['chromaPinOnly', 'f32'], // only the chroma pin fed to composite: color, no luma, no sync
  ['connectorGlitch', 'f32'], // loose connector: intermittent contact drops bands to snow
  // feedback (camera-at-monitor)
  ['fbMix', 'f32'],
  ['fbZoom', 'f32'],
  ['fbRotate', 'f32'], // radians
  ['fbShiftX', 'f32'],
  ['fbShiftY', 'f32'],
  ['fbGain', 'f32'],
  ['fbFocus', 'f32'], // camera lens defocus radius, output pixels
  ['fbVign', 'f32'], // lens vignette strength
  ['fbBlack', 'f32'], // sensor black cut level (trails die into black)
  ['fbKnee', 'f32'], // sensor s-curve amount (bloom + highlight compression)
  // CRT faceplate: the emissive screen the camera photographs (and the display
  // shows). Sits between the decoded signal and the camera/lens model above.
  ['crtCutoff', 'f32'], // beam cutoff: drive below the knee emits no light (true black background)
  ['crtGamma', 'f32'], // gun luminance response, luminance ~ drive^gamma (expands highlights, deepens shadows)
  ['crtSat', 'f32'], // saturation around luma, applied after the beam transfer
  ['crtBloom', 'f32'], // highlight bloom spread from bright phosphor cores
  ['crtHalation', 'f32'], // wide warm glass-scatter halo around highlights
  ['crtGlow', 'f32'], // phosphor black-level glow / faceplate haze
  // mixer loop: previous frame's composite fed back electrically
  ['cfbMix', 'f32'], // crossfader position toward the loop bus
  ['cfbGain', 'f32'], // loop proc-amp trim, negative inverts
  ['cfbDelay', 'f32'], // loop delay, samples (1 sample = 90 deg hue spin)
  ['cfbLines', 'f32'], // vertical offset per generation, lines
  ['cfbKey', 'f32'], // luma key amount, negative inverts polarity
  ['cfbKeyLevel', 'f32'], // key slice level, IRE
  ['cfbKeySoft', 'f32'], // key edge softness, IRE
  ['cfbTrail', 'f32'], // frame-store peak-hold decay (trails), 0 = plain capture
  ['cfbFilterFc', 'f32'], // loop resonance center, cycles/sample (0 = flat loop)
  ['cfbFilterQ', 'f32'], // loop resonance selectivity, 0 broad .. 1 narrow/ringing
  ['cfbFilterBoost', 'f32'], // added in-band loop gain (self-oscillates past unity round trip)
  // display
  ['scanBeam', 'f32'], // finite beam-spot strength between scanlines
  ['scanBloom', 'f32'], // beam-spot growth with beam current: bright lines fatten, gaps close in whites
  ['phosphor', 'f32'], // P22 persistence: green-channel frame-to-frame retention (R/B decay faster)
  ['phosphorMode', 'f32'], // tube colour identity: 0 sRGB, 1 P22/SMPTE-C, 2 NTSC-1953, 3 long-persistence green
  ['phosphorSkew', 'f32'], // R/B persistence decay exponent skew relative to G (trails die toward green)
  ['phosphorDecayMix', 'f32'], // persistence combine: 0 peak-hold (strobe) .. 1 additive light
  ['crtSharp', 'f32'], // horizontal Catmull-Rom reconstruction blend (0 bilinear)
  ['maskAmt', 'f32'], // aperture grille strength
  ['maskPitch', 'f32'], // grille triad pitch, canvas pixels
  ['dbgView', 'f32'], // 0 normal, 1 gradient (present test), 2 raw composite (encode test)
] as const

export const PARAM_BYTES = Math.ceil((PARAM_DEFS.length * 4) / 16) * 16
export const GEN_OFFSET = PARAM_DEFS.findIndex(([n]) => n === 'gen') * 4

// Union of every uniform name. Requiring a full record below makes a param
// added to PARAM_DEFS but never supplied a compile error instead of a runtime
// `missing param` throw.
export type ParamName = (typeof PARAM_DEFS)[number][0]

export function packParams(
  values: Record<ParamName, number>,
  out: ArrayBuffer,
): void {
  const dv = new DataView(out)
  PARAM_DEFS.forEach(([name, type], i) => {
    const v = values[name]
    if (type === 'u32') dv.setUint32(i * 4, v >>> 0, true)
    else dv.setFloat32(i * 4, v, true)
  })
}

const paramStruct = `struct Params {\n${PARAM_DEFS.map(([n, t]) => `  ${n}: ${t},`).join('\n')}\n}\n`

export const PRELUDE = /* wgsl */ `
const SPL = ${SAMPLES_PER_LINE}u;
const NLINES = ${LINES}u;
const BUF_LEN = ${SAMPLES_PER_LINE * LINES}u;
const SYNC_LEN = ${SYNC_LEN}u;
const BURST_START = ${BURST_START}u;
const BURST_LEN = ${BURST_LEN}u;
const ACTIVE_START = ${ACTIVE_START}u;
const ACTIVE_W = ${ACTIVE_WIDTH}u;
const ACTIVE_TOP = ${ACTIVE_TOP}u;
const ACTIVE_H = ${ACTIVE_HEIGHT}u;
const SAG_BASE = ${LINES + 3}u; // deflection sag region of the timing buffer
const VSYNC_FIRST = ${VSYNC_FIRST}u;
const VSYNC_LAST = ${VSYNC_LAST}u;
const HEAD_SWITCH_LINE = ${HEAD_SWITCH_LINE}u;
const IRE_SYNC = ${IRE_SYNC}.0;
const IRE_BLANK = ${IRE_BLANK}.0;
const IRE_BLACK = ${IRE_BLACK};
const VIDEO_RANGE = ${IRE_VIDEO_RANGE};
const BURST_AMP = ${BURST_AMP_IRE}.0;
const FILTER_STRIDE = ${FILTER_STRIDE}u;
const SEC_ENC_CHROMA = ${SEC_ENC_CHROMA}u;
const SEC_DEMOD = ${SEC_DEMOD}u;
const SEC_LUMA = ${SEC_LUMA}u;
const SEC_CHROMA_BP = ${SEC_CHROMA_BP}u;
const SEC_UNDER = ${SEC_UNDER}u;
const ENC_CHROMA_TAPS = ${TAPS.encChroma}u;
const DEMOD_TAPS = ${TAPS.demod}u;
const LUMA_TAPS = ${TAPS.luma}u;
const CHROMA_BP_TAPS = ${TAPS.chromaBp}u;
const UNDER_TAPS = ${TAPS.under}u;
const DOWN_PER_SAMPLE = ${DOWN_PER_SAMPLE}; // (fsc - f_under) / sample_rate
const PI = 3.14159265359;
// FIR tiling: each 64-thread workgroup stages its input span plus a
// 32-sample halo per side in shared memory, so symmetric kernels up to
// 65 taps read storage once per sample instead of once per tap.
const TILE = 128u;
const HALO = 32u;

${paramStruct}

// Subcarrier (sin, cos) at global sample index n. Sampling at exactly 4x fsc
// puts every sample on a 4-phase lattice, so the carrier is exact — no trig,
// no phase accumulation error. 910 samples/line = 227.5 cycles gives the
// 180-degree line alternation, 525 lines gives the frame alternation, both
// automatically via n mod 4.
fn carrier(n: u32, frame: u32) -> vec2f {
  var tab = array<vec2f, 4>(vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(0.0, -1.0), vec2f(-1.0, 0.0));
  return tab[(n + 2u * (frame & 1u)) & 3u];
}

fn clampIdx(i: i32) -> u32 {
  return u32(clamp(i, 0, i32(BUF_LEN) - 1));
}

// Raster row wrap that survives negative offsets: vertical roll runs both ways
// (the v-osc detunes either side of 60 Hz) and u32() of a negative float is
// undefined in WGSL.
fn wrapRow(r: i32) -> u32 {
  return u32(((r % i32(NLINES)) + i32(NLINES)) % i32(NLINES));
}

fn pcg(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn rand01(v: u32) -> f32 {
  return f32(pcg(v)) / 4294967295.0;
}

fn gauss(seed: u32) -> f32 {
  let a = max(rand01(seed), 1e-7);
  let b = rand01(seed ^ 0x9E3779B9u);
  return sqrt(-2.0 * log(a)) * cos(2.0 * PI * b);
}

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
}

// Gamut fit by desaturation. A hard per-channel clamp on an out-of-gamut colour
// only clips the overflowing channel, which rotates hue toward the remaining
// primaries — saturated content goes duller and wrong at the clipping point. This
// instead pulls the colour toward its own (clamped) luma along the chroma axis
// just far enough to re-enter the cube, so hue is preserved and a real tube's
// saturated highlights stay electric. In-gamut colours are returned unchanged.
fn gamutFit(c: vec3f) -> vec3f {
  let l = clamp(luma(c), 0.0, 1.0);
  let d = c - vec3f(luma(c));
  var s = 1.0;
  for (var i = 0; i < 3; i = i + 1) {
    let di = d[i];
    if (di > 1e-5) {
      s = min(s, (1.0 - l) / di);
    } else if (di < -1e-5) {
      s = min(s, -l / di);
    }
  }
  return clamp(vec3f(l) + max(s, 0.0) * d, vec3f(0.0), vec3f(1.0));
}

// Catmull-Rom fractional-delay read. Linear interpolation is -6 dB at fsc for
// half-sample offsets, so chroma pumps as a delay wanders; the cubic stays
// flat past fsc. t = 0 returns p1 exactly.
fn catmull(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
}
`
