// Circuit-bender's modulation sources: low-frequency oscillators and random
// walks standing in for the hands, LFOs, and photocells benders patch into
// pots. Pure per-frame state advanced at the frame rate; the engine maps the
// returned values onto controls at the uniform boundary, so presets, scenes,
// and the UI keep the resting value.

import { Lorenz, valueNoise } from './noise'

export type ModSource =
  | 'sine'
  | 'triangle'
  | 'walk'
  | 'smooth'
  | 'hold'
  | 'lorenz'
  | 'level'
  | 'hit'

export interface ModWave {
  source: ModSource
  rateHz: number
}

const DT = 1 / 60

export class ModState {
  private phase: number[] = []
  private clock: number[] = [] // unwrapped cycle count, for the aperiodic sources
  private walk: number[] = []
  private dest: number[] = []
  private held: number[] = []
  private lorenz: Lorenz[] = []

  // One value per wave: LFOs are bipolar [-1, 1] (a hand wiggling around the
  // resting setting), audio followers unipolar [0, 1] (a push off it).
  update(
    waves: readonly ModWave[],
    level: number,
    hit: number,
    rand: () => number = Math.random,
  ): number[] {
    while (this.phase.length < waves.length) {
      this.phase.push(0)
      this.clock.push(0)
      this.walk.push(0)
      this.dest.push(rand() * 2 - 1)
      this.held.push(rand() * 2 - 1)
      this.lorenz.push(new Lorenz())
    }
    return waves.map((w, i) => {
      const prev = this.phase[i]
      const ph = (prev + w.rateHz * DT) % 1
      this.phase[i] = ph
      this.clock[i] += w.rateHz * DT
      const wrapped = ph < prev // one source cycle completed this frame
      let v: number
      if (w.source === 'sine') {
        v = Math.sin(2 * Math.PI * ph)
      } else if (w.source === 'triangle') {
        v = 1 - 4 * Math.abs(ph - 0.5)
      } else if (w.source === 'walk') {
        // a new destination once per cycle, slewed toward — the aimless drift
        // of a hand resting on a bend point rather than a periodic wave
        if (wrapped) {
          this.dest[i] = rand() * 2 - 1
        }
        v =
          this.walk[i] +
          (this.dest[i] - this.walk[i]) * Math.min(1, 5 * w.rateHz * DT)
        this.walk[i] = v
      } else if (w.source === 'smooth') {
        // interpolated value noise: a gentler, more organic drift than walk
        v = valueNoise(this.clock[i], i)
      } else if (w.source === 'hold') {
        // sample & hold: a fresh random step latched once per cycle, held flat
        if (wrapped) {
          this.held[i] = rand() * 2 - 1
        }
        v = this.held[i]
      } else if (w.source === 'lorenz') {
        // strange-attractor coordinate: aperiodic but structured
        v = this.lorenz[i].step(w.rateHz * DT)
      } else {
        v = w.source === 'level' ? level : hit
      }
      return v
    })
  }
}
