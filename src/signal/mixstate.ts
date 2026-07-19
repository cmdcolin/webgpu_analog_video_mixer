// Non-genlocked source B: its line frequency, field rate, and subcarrier are
// all slightly off from A, so its picture slips horizontally, rolls
// vertically, and its chroma beats against the burst-locked decoder. The
// accumulators live here in f64 and are folded into per-frame uniforms.

import { LINES, SAMPLES_PER_LINE } from './constants'

const F_H = 4500000 / 286 // line rate, 15734.27 Hz
const LINE_S = 1 / F_H

export interface MixControls {
  bLineHz: number // B line-frequency offset
  bDetuneHz: number // B subcarrier detune
  bRollLps: number // B vertical slip, lines per frame
  wipePos: number // wipe position slider
  wipeRateHz: number // auto-sweep rate (ping-pong)
}

export interface MixUniforms {
  bShift0: number
  bShiftLine: number
  bPhase0: number
  bPhaseLine: number
  bRowOff: number
  wipePos: number
}

export class MixState {
  private hShift = 0
  private scPhase = 0 // turns
  private vRoll = 0
  private wipeT = 0

  update(c: MixControls): MixUniforms {
    const wrap = (x: number, m: number) => ((x % m) + m) % m
    const shiftPerLine = (c.bLineHz / F_H) * SAMPLES_PER_LINE
    this.hShift = wrap(this.hShift + shiftPerLine * LINES, SAMPLES_PER_LINE)
    this.scPhase = wrap(this.scPhase + c.bDetuneHz * LINE_S * LINES, 1)
    this.vRoll = wrap(this.vRoll + c.bRollLps, LINES)
    this.wipeT = c.wipeRateHz === 0 ? 0 : wrap(this.wipeT + (2 * c.wipeRateHz) / 60, 2)
    const wp = wrap(c.wipePos + this.wipeT, 2)
    return {
      wipePos: wp < 1 ? wp : 2 - wp,
      bShift0: this.hShift,
      bShiftLine: shiftPerLine,
      bPhase0: this.scPhase * 2 * Math.PI,
      bPhaseLine: 2 * Math.PI * c.bDetuneHz * LINE_S,
      bRowOff: Math.floor(this.vRoll),
    }
  }
}
