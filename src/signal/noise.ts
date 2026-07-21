// Bounded-aperiodic "slow drift" primitives shared by the CPU-side modulators.
// A periodic LFO traced straight down the raster reads as a filter effect, not
// a fault (see audiostate); these are the sources that don't. Everything here is
// deterministic given its seed/rand, so states stay reproducible.

// Smooth 1D value noise: random values on the integer lattice, smoothstep-
// interpolated. Aperiodic and continuous, bipolar ~[-1, 1). A gentler, more
// organic drift than either a periodic wave or a raw random walk. `t` advances
// at the source rate, so one new lattice value passes per unit of `t`.
export function valueNoise(t: number, seed = 0): number {
  const i = Math.floor(t)
  const f = t - i
  const u = f * f * (3 - 2 * f)
  return hashNoise(i, seed) * (1 - u) + hashNoise(i + 1, seed) * u
}

function hashNoise(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 0x80000000 - 1
}

// Lorenz attractor, forward-Euler with internal substepping for stability. A
// bounded strange attractor: aperiodic but structured — it dwells near two lobes
// and switches between them chaotically, never white noise and never periodic.
// `dt` is the integration advance, so the source rate maps onto orbit speed.
export class Lorenz {
  private x = 0.1
  private y = 0
  private z = 0

  step(dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / 0.01))
    const h = dt / steps
    for (let s = 0; s < steps; s++) {
      const dx = 10 * (this.y - this.x)
      const dy = this.x * (28 - this.z) - this.y
      const dz = this.x * this.y - (8 / 3) * this.z
      this.x += dx * h
      this.y += dy * h
      this.z += dz * h
    }
    return this.x / 24 // x rides ~[-20, 20]
  }
}

// Quasi-periodic tape wow. Real wow is the superposition of every rotating
// part's eccentricity — capstan, pinch roller, scanner — plus a reel term whose
// rate drifts as the tape-pack radius shrinks. Three incommensurate sinusoids
// never re-phase, so the wander never repeats; slowly AR(1)-drifting amplitudes
// keep it from reading as a fixed chord; the reel term's rate wanders on top.
// Bipolar, normalized to ~[-1, 1].
export class Wow {
  // mutually incommensurate rates (Hz): capstan, pinch roller, scanner. Each
  // curves within a field by `spread` radians — faster parts curve more — the
  // way the original single sine did, so the wander is visible down the raster.
  private readonly rates = [0.6, 1.07, 1.73]
  private readonly spreads = [0.9, 1.6, 2.6]
  private readonly amps = [0.8, 0.5, 0.35]
  private readonly ampTarget = [0.8, 0.5, 0.35]
  private reelRate = 0.31 // Hz, drifts with pack radius
  private reelPhase = 0

  constructor(private rand: () => number = Math.random) {}

  // Advance the slow states one field; call once per frame before sampling rows.
  advance(dt: number): void {
    for (let k = 0; k < this.amps.length; k++) {
      if (this.rand() < 0.01) {
        this.ampTarget[k] = 0.2 + this.rand()
      }
      this.amps[k] += (this.ampTarget[k] - this.amps[k]) * 0.02
    }
    this.reelRate += (0.31 - this.reelRate) * 0.01 + (this.rand() - 0.5) * 0.004
    this.reelPhase += 2 * Math.PI * this.reelRate * dt
  }

  // Sample the wander at absolute time `t`, at raster fraction `rowFrac` in
  // [0, 1). Normalized by the live amplitude sum so the peak stays near 1 as the
  // mix drifts.
  at(t: number, rowFrac: number): number {
    let sum = 0.4 * Math.sin(this.reelPhase + rowFrac * 0.5)
    let norm = 0.4
    for (let k = 0; k < this.rates.length; k++) {
      sum +=
        this.amps[k] *
        Math.sin(2 * Math.PI * this.rates[k] * t + rowFrac * this.spreads[k])
      norm += this.amps[k]
    }
    return sum / norm
  }
}
