// CPU-side per-line processes that must be continuous across frames: time-base
// error (wow + flutter random walk of an un-TBC'd deck), color-under phase
// wander, head-switch offset, per-line dropout seeds. Uploaded each frame as
// one vec4 per line: (tbOffsetSamples, underBasePhase, underJitterPhase, seed)

import {
  FSC,
  HEAD_SWITCH_LINE,
  LINES,
  SAMPLES_PER_LINE,
  SAMPLE_RATE,
  usToSamples,
} from './constants'
import { Wow } from './noise'

const F_UNDER = (40 * FSC) / 227.5 // 629.37 kHz color-under carrier
const F_DOWN = FSC - F_UNDER // heterodyne frequency
const DOWN_PER_SAMPLE = F_DOWN / SAMPLE_RATE

export interface LineStateControls {
  tbJitterNs: number // flutter: rms of per-line random walk step
  tbWowNs: number // wow: slow sinusoidal wander amplitude
  underJitterDeg: number // color-under phase wander per line
  headSwitchShiftUs: number // horizontal shift after the head switch point
  trackAmt: number // VHS tracking error severity
  trackPos: number // tracking band vertical position, 0..1
}

export class LineState {
  readonly data = new Float32Array(LINES * 4)
  private flutter = 0
  private underWalk = 0
  private t = 0
  private wow = new Wow()

  update(c: LineStateControls, frame: number): Float32Array<ArrayBuffer> {
    this.t += 1 / 60
    this.wow.advance(1 / 60)
    for (let row = 0; row < LINES; row++) {
      // flutter: random walk with a restoring pull, advanced per line
      this.flutter +=
        (Math.random() - 0.5) * usToSamples(c.tbJitterNs * 1e-3) * 0.7
      this.flutter *= 0.995
      // wow: quasi-periodic wander of the rotating parts, never a naked sine
      const wow = usToSamples(c.tbWowNs * 1e-3) * this.wow.at(this.t, row / LINES)
      const headSwitched = row >= HEAD_SWITCH_LINE
      const hs = headSwitched ? usToSamples(c.headSwitchShiftUs) : 0

      // tracking band tear: lines near the mistracked band hook sideways,
      // strongest at the band center, with a little per-line jitter
      const trackCenter = c.trackPos * LINES
      const trackHalf = 3 + 18 * c.trackAmt
      const trackDist = Math.abs(row - trackCenter)
      const track =
        c.trackAmt > 0 && trackDist < trackHalf
          ? usToSamples(6 * c.trackAmt) *
            (1 - trackDist / trackHalf) *
            (0.6 + 0.8 * Math.random())
          : 0

      // color-under playback carrier phase for this line: exact base phase
      // (computed in f64 — f32 cannot hold it) plus accumulated jitter walk
      const globalSample = (frame * LINES + row) * SAMPLES_PER_LINE
      const base = (DOWN_PER_SAMPLE * globalSample) % 1
      this.underWalk +=
        (Math.random() - 0.5) * ((c.underJitterDeg * Math.PI) / 180)
      this.underWalk *= 0.99

      const o = row * 4
      this.data[o] = this.flutter + wow + hs + track
      this.data[o + 1] = base * 2 * Math.PI
      this.data[o + 2] = this.underWalk + (headSwitched ? 0.9 : 0)
      this.data[o + 3] = Math.random()
    }
    return this.data
  }
}

export { F_DOWN, DOWN_PER_SAMPLE }
