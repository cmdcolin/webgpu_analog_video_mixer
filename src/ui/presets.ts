import { DEFAULT_CONTROLS } from '../controls'
import type { ControlKey, Controls } from '../controls'
import { SLIDER_BY_KEY } from './controls'

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
    blurb:
      'Pristine studio signal — no artifacts. The baseline everything else departs from.',
    patch: {},
  },
  {
    name: 'vhs',
    group: 'Tape wear',
    blurb:
      'Home VHS: softened luma, color-under chroma, light head-switch wobble and specks.',
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
    blurb:
      'Third-gen dub: mushy detail, heavy grain, frequent dropouts and bad tracking.',
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
    blurb:
      'Clean over-the-air feed: a whisper of noise and a soft multipath ghost.',
    patch: { noiseIre: 1.2, ghostDelayUs: 1.8, ghostGain: 0.1, demodMHz: 0.8 },
  },
  {
    name: 'mistuned rf',
    group: 'RF / Broadcast',
    blurb:
      'Tuner off-station: sound-carrier buzz, snow, a hard ghost and struggling AGC.',
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
    blurb:
      'No signal: full snow, hum bars, rolling picture and collapsing sync.',
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
    name: 'vertical hold gone',
    group: 'Sync / Deflection',
    blurb:
      'Vertical oscillator detuned past its pull-in range: the picture scrolls forever, VBI bar and all, hooking sideways at every seam.',
    patch: {
      vFreqHz: 54,
      vHold: 0.35,
      syncBendUs: 7,
      hHold: 0.2,
      noiseIre: 2.5,
    },
  },
  {
    name: 'bent scan',
    group: 'Sync / Deflection',
    blurb:
      'Deflection bowed hard across the glass — the blanking interval itself curves through the picture.',
    patch: { bendUs: 24, bendShape: 2, syncBendUs: 4, noiseIre: 2 },
  },
  {
    name: 'supply chaos',
    group: 'Sync / Deflection',
    blurb:
      'Beam current bending its own scan through a ringing HV supply: geometry driven by picture content, never repeating.',
    patch: {
      hvSagUs: 16,
      hvRing: 0.85,
      bGain: 0.55,
      bLineHz: 0.9,
      bDetuneHz: 130,
      bRollLps: 0.2,
      bRing: 0.3,
      noiseIre: 2,
    },
  },
  {
    name: 'full collapse',
    group: 'Sync / Deflection',
    blurb:
      'Every deflection fault at once, feeding the mixer loop — bend, roll and beam load chasing each other frame to frame.',
    patch: {
      hvSagUs: 20,
      hvRing: 0.9,
      bendUs: 12,
      bendShape: 2,
      vFreqHz: 58.5,
      vHold: 0.4,
      syncBendUs: 6,
      hHold: 0.18,
      bGain: 0.6,
      bLineHz: 0.9,
      bDetuneHz: 130,
      bRollLps: 0.2,
      cfbMix: 0.45,
      cfbLines: 3,
      phosphor: 0.6,
      noiseIre: 3,
    },
  },
  {
    name: 'bass smack',
    group: 'Sync / Deflection',
    blurb:
      'Every kick slams the HV supply and knocks vertical hold loose, then it snaps back. Enable the microphone under Audio.',
    patch: {
      audioRoll: 5,
      audioTear: 130,
      audioLoad: 2.2,
      // a little standing sag for character, most of it on the onset so the
      // tube sits nearly still between hits and the kick actually lands
      hvSagUs: 7,
      audioSagUs: 24,
      hvRing: 0.8,
      vHold: 0.45,
      hHold: 0.3,
      phosphor: 0.5,
      noiseIre: 2,
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
    patch: {
      cfbMix: 0.6,
      cfbTrail: 0.9,
      cfbHold: 3,
      cfbDelayUs: 0.1,
      noiseIre: 2,
    },
  },
  {
    name: 'key loop',
    group: 'Feedback loops',
    blurb:
      'Luma-keyed feedback — only bright areas re-enter the loop and tunnel.',
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
    blurb:
      'Camera-style zoom + rotate feedback blooming outward into a tunnel.',
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
    name: 'clean dissolve',
    group: 'A/B mixing',
    blurb:
      'Source B genlocked to the house reference and dissolved half over A — a clean switcher mix, no beat or roll.',
    patch: {
      bGenlock: 1,
      bGain: 0.5,
    },
  },
  {
    name: 'dirty mix',
    group: 'A/B mixing',
    blurb:
      'Source B bleeds in off-frequency and off-line, tearing the horizontal sync.',
    patch: {
      bGain: 0.55,
      bLineHz: 0.6,
      bDetuneHz: 120,
      bRollLps: 0.2,
      hHold: 0.22,
      noiseIre: 2,
    },
  },
  {
    name: 'difference key',
    group: 'A/B mixing',
    blurb:
      'Source A inverted on its own bus fader and summed against B: where the two pictures agree they cancel to flat grey, where they differ the mix lights up, with a slow chroma beat riding through.',
    patch: {
      aGain: -1,
      bGain: 1,
      bLineHz: 0,
      bDetuneHz: 30,
      bRollLps: 0,
      noiseIre: 1.5,
    },
  },
  {
    name: 'dirty dissolve',
    group: 'A/B mixing',
    blurb:
      'A manual crossfade on the summing bus — A pulled halfway down under B — but B is still off-frequency and off-line, so the dissolve beats and rolls instead of sitting clean like the genlocked one.',
    patch: {
      aGain: 0.5,
      bGain: 0.6,
      bLineHz: 0.3,
      bDetuneHz: 60,
      bRollLps: 0.12,
      hHold: 0.28,
      noiseIre: 1.8,
    },
  },
  {
    name: 'wipe fight',
    group: 'A/B mixing',
    blurb:
      'Two sources battling across a slowly sweeping wipe, sync fighting to hold.',
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
    blurb:
      'Reversed polarity on the composite line — luma and every hue flip to their complement.',
    patch: { invert: 1 },
  },
  {
    name: 's-video miswire',
    group: 'Cross-wired',
    blurb:
      'Y and C pins cross-wired into composite: subcarrier crawls into brightness, color smears loose.',
    patch: { svideoBleed: 0.85, chromaGain: 1.7, hHold: 0.2, noiseIre: 1.5 },
  },
  {
    name: 'reverse polarity',
    group: 'Bad cables',
    blurb:
      'Signal and ground fully swapped: sync inverts too, so the picture tears and rolls as colors flip.',
    patch: { polarityFlip: 1 },
  },
  {
    name: 'no terminator',
    group: 'Bad cables',
    blurb:
      'Unterminated line running hot — blown highlights and edges ringing from the reflected wave.',
    patch: { termination: 0.7, agc: 0.3 },
  },
  {
    name: 'daisy-chained',
    group: 'Bad cables',
    blurb:
      'Two monitors on one line double-terminate it: dim, washed out, sync barely holding.',
    patch: { termination: -0.8, agc: 0.5, hHold: 0.5, noiseIre: 2 },
  },
  {
    name: 'chroma only',
    group: 'Bad cables',
    blurb:
      'Only the chroma pin reaches the input — burst-locked color glowing on black, no luma to hold sync.',
    patch: { chromaPinOnly: 1, chromaGain: 1.4 },
  },
  {
    name: 'loose connector',
    group: 'Bad cables',
    blurb:
      'Intermittent contact: bands of the picture cut to snow and flicker as the plug wiggles.',
    patch: { connectorGlitch: 0.45, noiseIre: 2 },
  },
  {
    name: 'bent enhancer',
    group: 'Circuit bent',
    blurb:
      'Output bridged back to input through a resonant network, keyed by its own brightness: the band rings past unity and a woven oscillation eats into the picture wherever the loop finds light.',
    patch: {
      cfbMix: 0.55,
      cfbGain: 1.0,
      cfbDelayUs: 0.25,
      cfbLines: 1,
      cfbFilterMHz: 1.3,
      cfbFilterQ: 0.75,
      cfbFilterBoost: 2.0,
      cfbKey: 0.8,
      cfbKeyLevel: 52,
      cfbKeySoft: 10,
      noiseIre: 1.5,
    },
  },
  {
    name: 'rainbow storm',
    group: 'Circuit bent',
    blurb:
      'The 3.58 MHz crystal pulled far off-frequency: hue shears across every line and barber-poles down the frame faster than the burst loop can chase it.',
    patch: {
      scDetuneKHz: 7,
      burstLock: 0.55,
      chromaGain: 1.2,
      hHold: 0.25,
      noiseIre: 2,
    },
  },
  {
    name: 'neon tube',
    group: 'Phosphor / CRT',
    blurb:
      'A camcorder pointed at a CRT at night: beam cutoff crushes the background to true black, gamma blooms the cores white-hot, and saturated colour stays electric at the clipping point.',
    patch: {
      crtCutoff: 0.12,
      crtGamma: 2.4,
      crtSat: 1.4,
      crtBloom: 0.6,
      crtHalation: 0.5,
      crtGlow: 0.3,
      chromaGain: 1.5,
    },
  },
  {
    name: 'round tube',
    group: 'Phosphor / CRT',
    blurb:
      'Early-60s colorimetry: the deep 1953 phosphors on an Illuminant-C white — green and red pull in, whites cool, bright lines fatten between visible scanlines.',
    patch: {
      phosphorMode: 2,
      crtCutoff: 0.06,
      crtGamma: 2.2,
      crtBloom: 0.3,
      crtHalation: 0.3,
      crtGlow: 0.15,
      scanBeam: 0.45,
      scanBloom: 0.7,
      phosphor: 0.4,
    },
  },
  {
    name: 'green terminal',
    group: 'Phosphor / CRT',
    blurb:
      'Long-persistence mono green tube (P1 family): everything lands on one phosphor, and motion hangs as a seconds-long tail that sums like light, not paint.',
    patch: {
      phosphorMode: 3,
      phosphor: 0.99,
      phosphorDecayMix: 0.35,
      crtCutoff: 0.08,
      crtGamma: 2.2,
      crtBloom: 0.5,
      scanBeam: 0.5,
      scanBloom: 0.5,
    },
  },
  {
    name: 'black restore',
    group: 'Phosphor / CRT',
    blurb:
      'Just the beam transfer — cutoff and gun gamma with no bloom. Lifts the decoded pedestal off the floor for a clean tube with a genuinely black background.',
    patch: {
      crtCutoff: 0.08,
      crtGamma: 2.2,
    },
  },
]

export function presetControls(patch: Partial<Controls>): Controls {
  return { ...DEFAULT_CONTROLS, ...patch }
}

export const CONTROL_KEYS = Object.keys(DEFAULT_CONTROLS) as ControlKey[]

export function controlsEqual(a: Controls, b: Controls): boolean {
  return CONTROL_KEYS.every(k => a[k] === b[k])
}

// The preset whose full control-set exactly matches `values`, if any.
export function matchPreset(values: Controls): PresetDef | undefined {
  return PRESETS.find(p => controlsEqual(presetControls(p.patch), values))
}

// How much of each preset is dialed in, by preset name. Absent or 0 is off.
export type PresetWeights = ReadonlyMap<string, number>

// Controls holding a mode rather than a quantity: halfway between phosphor 0
// and 3 is not phosphor 1.5, it is a tube nobody asked for. The heaviest
// preset that moves one of these off its default picks the mode outright.
// Derived from which controls declare `choices`, so the blender and the panel's
// toggle groups can't drift from one hand-kept list.
const ENUM_KEYS = new Set<ControlKey>(
  [...SLIDER_BY_KEY.values()].filter(s => s.choices).map(s => s.key),
)

// Snap a summed value back onto its slider's range and grid, so a mix lands on
// values the UI can actually show and `matchPreset` can compare exactly.
function quantize(key: ControlKey, v: number): number {
  const s = SLIDER_BY_KEY.get(key)
  return s === undefined
    ? v
    : Number(
        (
          Math.round(Math.min(s.max, Math.max(s.min, v)) / s.step) * s.step
        ).toFixed(6),
      )
}

// Presets mix by summing their departures from default onto `baseline`, so
// dialing in two faults accumulates both instead of the later one winning.
// Weight 1 on a single preset over the default baseline reproduces
// `presetControls(patch)` exactly, which is what keeps `matchPreset` honest.
export function blendPresets(
  baseline: Controls,
  weights: PresetWeights,
): Controls {
  const active = [...weights]
    .filter(([, w]) => w > 0)
    .sort(([, a], [, b]) => b - a)
    .flatMap(([name, w]) => {
      const def = PRESETS.find(p => p.name === name)
      return def === undefined ? [] : [{ w, full: presetControls(def.patch) }]
    })
  const out = { ...baseline }
  for (const k of CONTROL_KEYS) {
    const moved = active.filter(a => a.full[k] !== DEFAULT_CONTROLS[k])
    if (moved.length > 0) {
      // `active` is heaviest-first, so the leading mover wins the enum keys.
      out[k] = ENUM_KEYS.has(k)
        ? moved[0].full[k]
        : quantize(
            k,
            moved.reduce(
              (acc, a) => acc + a.w * (a.full[k] - DEFAULT_CONTROLS[k]),
              baseline[k],
            ),
          )
    }
  }
  return out
}
