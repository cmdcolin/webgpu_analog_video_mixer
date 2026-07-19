import type { Controls } from '../gpu/pipeline'
import { DEFAULT_CONTROLS } from '../gpu/pipeline'

// Built-in presets are absolute: defaults + patch.
export const BUILTIN_PRESETS: Record<string, Partial<Controls>> = {
  clean: {},
  broadcast: { noiseIre: 1.2, ghostDelayUs: 1.8, ghostGain: 0.1, demodMHz: 0.8 },
  vhs: {
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
  'worn tape': {
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
  'dirty mix': {
    bGain: 0.55,
    bLineHz: 0.6,
    bDetuneHz: 120,
    bRollLps: 0.2,
    hHold: 0.22,
    noiseIre: 2,
  },
  'mixer loop': {
    cfbMix: 0.65,
    cfbDelayUs: 0.12,
    cfbLines: 3,
    noiseIre: 1.5,
  },
  'wipe fight': {
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
  'strobe trails': {
    cfbMix: 0.6,
    cfbTrail: 0.9,
    cfbHold: 3,
    cfbDelayUs: 0.1,
    noiseIre: 2,
  },
  'key loop': {
    cfbMix: 0.8,
    cfbKey: 0.85,
    cfbKeyLevel: 45,
    cfbKeySoft: 8,
    cfbDelayUs: 0.25,
    cfbLines: 2,
    noiseIre: 1.5,
  },
  'mistuned rf': {
    soundIre: 3.5,
    noiseIre: 6,
    ghostDelayUs: 2.4,
    ghostGain: 0.18,
    agc: 0.4,
    tbJitterNs: 80,
  },
  'fb bloom': {
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
  'dead channel': {
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
}

export function presetControls(patch: Partial<Controls>): Controls {
  return { ...DEFAULT_CONTROLS, ...patch }
}

const SLOT_KEY = 'video_feedback_slots'

export function loadSlots(): Record<string, Controls> {
  const raw = localStorage.getItem(SLOT_KEY)
  return raw === null ? {} : (JSON.parse(raw) as Record<string, Controls>)
}

export function saveSlot(slot: number, controls: Controls): void {
  const slots = loadSlots()
  slots[String(slot)] = { ...controls }
  localStorage.setItem(SLOT_KEY, JSON.stringify(slots))
}
