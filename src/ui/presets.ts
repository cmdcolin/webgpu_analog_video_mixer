import type { ControlKey, Controls } from '../gpu/pipeline'
import { DEFAULT_CONTROLS } from '../gpu/pipeline'

export interface PresetDef {
  name: string
  group: string
  blurb: string
  patch: Partial<Controls>
}

// Built-in presets are absolute: defaults + patch. Ordered by group so the UI
// can render them under labeled headers.
export const PRESETS: PresetDef[] = [
  {
    name: 'clean',
    group: 'Clean',
    blurb: 'Pristine studio signal — no artifacts. The baseline everything else departs from.',
    patch: {},
  },
  {
    name: 'vhs',
    group: 'Tape wear',
    blurb: 'Home VHS: softened luma, color-under chroma, light head-switch wobble and specks.',
    patch: {
      lumaMHz: 2.8,
      lumaPeak: 0.8,
      noiseIre: 3,
      colorUnderMix: 1,
      underJitterDeg: 4,
      tbJitterNs: 150,
      tbWowNs: 300,
      headSwitchShiftUs: 0.8,
      headSwitchNoise: 0.4,
      dropoutRate: 6,
      demodMHz: 0.5,
    },
  },
  {
    name: 'worn tape',
    group: 'Tape wear',
    blurb: 'Third-gen dub: mushy detail, heavy grain, frequent dropouts and bad tracking.',
    patch: {
      dubGens: 2,
      lumaMHz: 2.2,
      lumaPeak: 1.4,
      noiseIre: 7,
      colorUnderMix: 1,
      underJitterDeg: 10,
      tbJitterNs: 400,
      tbWowNs: 900,
      headSwitchShiftUs: 1.6,
      headSwitchNoise: 0.8,
      dropoutRate: 25,
      dropoutLenUs: 9,
      ghostDelayUs: 3,
      ghostGain: 0.15,
      demodMHz: 0.45,
    },
  },
  {
    name: 'broadcast',
    group: 'RF / Broadcast',
    blurb: 'Clean over-the-air feed: a whisper of noise and a soft multipath ghost.',
    patch: { noiseIre: 1.2, ghostDelayUs: 1.8, ghostGain: 0.1, demodMHz: 0.8 },
  },
  {
    name: 'mistuned rf',
    group: 'RF / Broadcast',
    blurb: 'Tuner off-station: sound-carrier buzz, snow, a hard ghost and struggling AGC.',
    patch: {
      soundIre: 3.5,
      noiseIre: 6,
      ghostDelayUs: 2.4,
      ghostGain: 0.18,
      agc: 0.4,
      tbJitterNs: 80,
    },
  },
  {
    name: 'dead channel',
    group: 'RF / Broadcast',
    blurb: 'No signal: full snow, hum bars, rolling picture and collapsing sync.',
    patch: {
      noiseIre: 32,
      killThresh: 8,
      agc: 0.7,
      hHold: 0.6,
      tbJitterNs: 600,
      tbWowNs: 1200,
      dropoutRate: 40,
      dropoutLenUs: 14,
      ghostDelayUs: 6,
      ghostGain: 0.3,
      humAmp: 8,
    },
  },
  {
    name: 'mixer loop',
    group: 'Feedback loops',
    blurb: 'Composite fed back into itself — each line echoes into the next.',
    patch: { cfbMix: 0.65, cfbDelayUs: 0.12, cfbLines: 3, noiseIre: 1.5 },
  },
  {
    name: 'strobe trails',
    group: 'Feedback loops',
    blurb: 'Held frames blended forward, smearing motion into long trails.',
    patch: { cfbMix: 0.6, cfbTrail: 0.9, cfbHold: 3, cfbDelayUs: 0.1, noiseIre: 2 },
  },
  {
    name: 'key loop',
    group: 'Feedback loops',
    blurb: 'Luma-keyed feedback — only bright areas re-enter the loop and tunnel.',
    patch: {
      cfbMix: 0.8,
      cfbKey: 0.85,
      cfbKeyLevel: 45,
      cfbKeySoft: 8,
      cfbDelayUs: 0.25,
      cfbLines: 2,
      noiseIre: 1.5,
    },
  },
  {
    name: 'fb bloom',
    group: 'Feedback loops',
    blurb: 'Camera-style zoom + rotate feedback blooming outward into a tunnel.',
    patch: {
      fbMix: 0.82,
      fbZoom: 1.045,
      fbRotateDeg: 2.5,
      fbGain: 1.18,
      fbFocus: 1.3,
      fbBlack: 0.05,
      fbKnee: 0.65,
      fbVign: 0.35,
      noiseIre: 1.5,
    },
  },
  {
    name: 'dirty mix',
    group: 'A/B mixing',
    blurb: 'Source B bleeds in off-frequency and off-line, tearing the horizontal sync.',
    patch: { bGain: 0.55, bLineHz: 0.6, bDetuneHz: 120, bRollLps: 0.2, hHold: 0.22, noiseIre: 2 },
  },
  {
    name: 'wipe fight',
    group: 'A/B mixing',
    blurb: 'Two sources battling across a slowly sweeping wipe, sync fighting to hold.',
    patch: {
      bGain: 0.6,
      bLineHz: 1.2,
      bDetuneHz: 150,
      bRollLps: 0.15,
      wipeMode: 1,
      wipeSoft: 0.03,
      wipeRate: 0.25,
      hHold: 0.25,
      noiseIre: 2,
    },
  },
  {
    name: 'negative',
    group: 'Cross-wired',
    blurb: 'Reversed polarity on the composite line — luma and every hue flip to their complement.',
    patch: { invert: 1 },
  },
  {
    name: 's-video miswire',
    group: 'Cross-wired',
    blurb: 'Y and C pins cross-wired into composite: subcarrier crawls into brightness, color smears loose.',
    patch: { svideoBleed: 0.85, chromaGain: 1.7, hHold: 0.2, noiseIre: 1.5 },
  },
  {
    name: 'reverse polarity',
    group: 'Bad cables',
    blurb: 'Signal and ground fully swapped: sync inverts too, so the picture tears and rolls as colors flip.',
    patch: { polarityFlip: 1 },
  },
  {
    name: 'no terminator',
    group: 'Bad cables',
    blurb: 'Unterminated line running hot — blown highlights and edges ringing from the reflected wave.',
    patch: { termination: 0.7, agc: 0.3 },
  },
  {
    name: 'daisy-chained',
    group: 'Bad cables',
    blurb: 'Two monitors on one line double-terminate it: dim, washed out, sync barely holding.',
    patch: { termination: -0.8, agc: 0.5, hHold: 0.5, noiseIre: 2 },
  },
  {
    name: 'chroma only',
    group: 'Bad cables',
    blurb: 'Only the chroma pin reaches the input — burst-locked color glowing on black, no luma to hold sync.',
    patch: { chromaPinOnly: 1, chromaGain: 1.4 },
  },
  {
    name: 'loose connector',
    group: 'Bad cables',
    blurb: 'Intermittent contact: bands of the picture cut to snow and flicker as the plug wiggles.',
    patch: { connectorGlitch: 0.45, noiseIre: 2 },
  },
]

export function presetControls(patch: Partial<Controls>): Controls {
  return { ...DEFAULT_CONTROLS, ...patch }
}

const CONTROL_KEYS = Object.keys(DEFAULT_CONTROLS) as ControlKey[]

// The preset whose full control-set exactly matches `values`, if any.
export function matchPreset(values: Controls): PresetDef | undefined {
  return PRESETS.find((p) => CONTROL_KEYS.every((k) => presetControls(p.patch)[k] === values[k]))
}
