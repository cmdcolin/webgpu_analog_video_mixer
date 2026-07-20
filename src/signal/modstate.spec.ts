import { describe, expect, it } from 'vitest'
import { ModState } from './modstate'

const step = (
  m: ModState,
  waves: Parameters<ModState['update']>[0],
  n: number,
  rand: () => number = () => 0.5,
) => {
  let out: number[] = []
  for (let i = 0; i < n; i++) out = m.update(waves, 0.3, 0.9, rand)
  return out
}

describe('ModState', () => {
  it('sine reaches +1 a quarter cycle in and is periodic', () => {
    const m = new ModState()
    const wave = [{ source: 'sine', rateHz: 1 } as const]
    expect(step(m, wave, 15)[0]).toBeCloseTo(1, 6)
    expect(step(m, wave, 45)[0]).toBeCloseTo(0, 6) // full cycle from start
  })

  it('triangle spans -1..1 bipolar', () => {
    const m = new ModState()
    const wave = [{ source: 'triangle', rateHz: 1 } as const]
    expect(step(m, wave, 30)[0]).toBeCloseTo(1, 6) // half cycle = peak
    expect(step(m, wave, 30)[0]).toBeCloseTo(-1, 6) // wrap = trough
  })

  it('walk slews toward the sampled destination and stays bounded', () => {
    const m = new ModState()
    const wave = [{ source: 'walk', rateHz: 2 } as const]
    const vals = Array.from(
      { length: 120 },
      () => m.update(wave, 0, 0, () => 1)[0], // dest pinned at +1
    )
    expect(Math.max(...vals.map(Math.abs))).toBeLessThanOrEqual(1)
    expect(vals[119]).toBeGreaterThan(0.9) // converged toward +1
    expect(vals[10]).toBeLessThan(vals[60]) // monotone-ish approach
  })

  it('audio followers pass the envelope through', () => {
    const m = new ModState()
    const out = m.update(
      [
        { source: 'level', rateHz: 1 },
        { source: 'hit', rateHz: 1 },
      ],
      0.3,
      0.9,
      () => 0.5,
    )
    expect(out).toEqual([0.3, 0.9])
  })

  it('tracks independent phase per slot', () => {
    const m = new ModState()
    const waves = [
      { source: 'sine', rateHz: 1 },
      { source: 'sine', rateHz: 2 },
    ] as const
    const out = step(m, waves, 15)
    expect(out[0]).toBeCloseTo(1, 6)
    expect(out[1]).toBeCloseTo(0, 6) // twice the rate: half cycle
  })
})
