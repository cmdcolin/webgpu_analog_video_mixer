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
import { FILTER_STRIDE, SEC_CHROMA_BP, SEC_DEMOD, SEC_ENC_CHROMA, SEC_LUMA, SEC_UNDER } from '../signal/filters'
import { DOWN_PER_SAMPLE } from '../signal/linestate'

type ParamType = 'f32' | 'u32'

export const PARAM_DEFS: ReadonlyArray<readonly [string, ParamType]> = [
  ['frame', 'u32'],
  ['gen', 'u32'], // dub generation index: decorrelates noise/dropout seeds per pass
  ['encChromaTaps', 'u32'],
  ['demodTaps', 'u32'],
  ['lumaTaps', 'u32'],
  ['chromaBpTaps', 'u32'],
  ['underTaps', 'u32'],
  ['canvasW', 'f32'],
  ['canvasH', 'f32'],
  ['srcAspect', 'f32'],
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
  // decoder
  ['combMode', 'f32'], // 0 chroma trap, 1 two-line comb, 2 three-line comb
  ['hHold', 'f32'], // sync PLL gain (horizontal hold)
  ['vHold', 'f32'], // vertical hold strength
  ['chromaGain', 'f32'],
  ['burstLock', 'f32'], // 0..1: how much the decoder trusts the (degraded) burst
  ['killThresh', 'f32'], // IRE of burst amplitude below which color killer engages
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
  // mixer loop: previous frame's composite fed back electrically
  ['cfbMix', 'f32'], // crossfader position toward the loop bus
  ['cfbGain', 'f32'], // loop proc-amp trim, negative inverts
  ['cfbDelay', 'f32'], // loop delay, samples (1 sample = 90 deg hue spin)
  ['cfbLines', 'f32'], // vertical offset per generation, lines
  ['cfbKey', 'f32'], // luma key amount, negative inverts polarity
  ['cfbKeyLevel', 'f32'], // key slice level, IRE
  ['cfbKeySoft', 'f32'], // key edge softness, IRE
  ['cfbTrail', 'f32'], // frame-store peak-hold decay (trails), 0 = plain capture
  // display
  ['scanBeam', 'f32'], // finite beam-spot strength between scanlines
  ['dbgView', 'f32'], // 0 normal, 1 gradient (present test), 2 raw composite (encode test)
] as const

export const PARAM_BYTES = Math.ceil((PARAM_DEFS.length * 4) / 16) * 16
export const GEN_OFFSET = PARAM_DEFS.findIndex(([n]) => n === 'gen') * 4

export function packParams(values: Record<string, number>, out: ArrayBuffer): void {
  const dv = new DataView(out)
  PARAM_DEFS.forEach(([name, type], i) => {
    const v = values[name]
    if (v === undefined) throw new Error(`missing param ${name}`)
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
const DOWN_PER_SAMPLE = ${DOWN_PER_SAMPLE}; // (fsc - f_under) / sample_rate
const PI = 3.14159265359;

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

// Catmull-Rom fractional-delay read. Linear interpolation is -6 dB at fsc for
// half-sample offsets, so chroma pumps as a delay wanders; the cubic stays
// flat past fsc. t = 0 returns p1 exactly.
fn catmull(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
}
`
