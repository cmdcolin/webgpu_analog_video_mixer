// Circuit-bender's modulation sources: low-frequency oscillators and random
// walks standing in for the hands, LFOs, and photocells benders patch into
// pots. Pure per-frame state advanced at the frame rate; the engine maps the
// returned values onto controls at the uniform boundary, so presets, scenes,
// and the UI keep the resting value.

export type ModSource = 'sine' | 'triangle' | 'walk' | 'level' | 'hit'

export interface ModWave {
  source: ModSource
  rateHz: number
}

const DT = 1 / 60

export class ModState {
  private phase: number[] = []
  private walk: number[] = []
  private dest: number[] = []

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
      this.walk.push(0)
      this.dest.push(rand() * 2 - 1)
    }
    return waves.map((w, i) => {
      const prev = this.phase[i]
      const ph = (prev + w.rateHz * DT) % 1
      this.phase[i] = ph
      let v: number
      if (w.source === 'sine') {
        v = Math.sin(2 * Math.PI * ph)
      } else if (w.source === 'triangle') {
        v = 1 - 4 * Math.abs(ph - 0.5)
      } else if (w.source === 'walk') {
        // a new destination once per cycle, slewed toward — the aimless drift
        // of a hand resting on a bend point rather than a periodic wave
        if (ph < prev) {
          this.dest[i] = rand() * 2 - 1
        }
        v = this.walk[i] + (this.dest[i] - this.walk[i]) * Math.min(1, 5 * w.rateHz * DT)
        this.walk[i] = v
      } else {
        v = w.source === 'level' ? level : hit
      }
      return v
    })
  }
}
