import { describe, expect, it } from 'vitest'
import { Lorenz, valueNoise, Wow } from './noise'

describe('valueNoise', () => {
  it('is bounded, continuous, and returns lattice points exactly', () => {
    const a = valueNoise(3, 7)
    const b = valueNoise(4, 7)
    expect(valueNoise(3.0, 7)).toBe(a) // integer t hits the lattice
    // smoothstep interpolates monotonically toward the next lattice value
    const mid = valueNoise(3.5, 7)
    expect(mid).toBeGreaterThanOrEqual(Math.min(a, b))
    expect(mid).toBeLessThanOrEqual(Math.max(a, b))
    for (let t = 0; t < 50; t += 0.13) {
      expect(Math.abs(valueNoise(t, 1))).toBeLessThanOrEqual(1)
    }
  })

  it('decorrelates across seeds', () => {
    expect(valueNoise(2.5, 1)).not.toBe(valueNoise(2.5, 2))
  })
})

describe('Lorenz', () => {
  it('does not diverge even with a large step', () => {
    const l = new Lorenz()
    let last = 0
    for (let i = 0; i < 500; i++) last = l.step(0.2)
    expect(Number.isFinite(last)).toBe(true)
    expect(Math.abs(last)).toBeLessThan(1.2)
  })
})

describe('Wow', () => {
  it('stays bounded and does not repeat like a single sine', () => {
    const w = new Wow(() => 0.5) // deterministic drift
    const samples: number[] = []
    for (let f = 0; f < 600; f++) {
      w.advance(1 / 60)
      samples.push(w.at(f / 60, 0.5))
    }
    expect(Math.max(...samples.map(Math.abs))).toBeLessThan(1.1)
    // a pure 0.6 Hz sine over 10 s would repeat every 100 frames; the quasi-
    // periodic sum should not line up with any single-period shift
    const period = 100
    let err = 0
    for (let i = 0; i < samples.length - period; i++) {
      err += Math.abs(samples[i] - samples[i + period])
    }
    expect(err / (samples.length - period)).toBeGreaterThan(0.1)
  })
})
