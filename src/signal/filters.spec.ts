import { describe, expect, it } from 'vitest'
import { SAMPLE_RATE } from './constants'
import {
  FILTER_STRIDE,
  TAPS,
  bandpass,
  lowpass,
  lowpassCausal,
  lowpassPeaked,
  mixTaps,
  packFilterBank,
} from './filters'

// Evaluate a real FIR's frequency response magnitude at freqHz.
// H(f) = sum_k h[k] e^{-j 2pi f k / fs}; the group delay (linear phase) drops
// out of |H|, so summing against a shifted index is unnecessary for magnitude.
function response(h: Float32Array, freqHz: number): number {
  const w = (2 * Math.PI * freqHz) / SAMPLE_RATE
  let re = 0
  let im = 0
  for (let k = 0; k < h.length; k++) {
    re += h[k] * Math.cos(w * k)
    im -= h[k] * Math.sin(w * k)
  }
  return Math.hypot(re, im)
}

function isSymmetric(h: Float32Array): boolean {
  const n = h.length
  for (let k = 0; k < n >> 1; k++) {
    if (Math.abs(h[k] - h[n - 1 - k]) > 1e-12) return false
  }
  return true
}

describe('lowpass', () => {
  it('has unity DC gain', () => {
    const h = lowpass(4.2e6, 49)
    let sum = 0
    for (const v of h) sum += v
    expect(sum).toBeCloseTo(1, 6)
  })

  it('passes below and rejects above the cutoff', () => {
    const cutoff = 3e6
    const h = lowpass(cutoff, 65)
    expect(response(h, 0.5e6)).toBeCloseTo(1, 1)
    // A Blackman window gives deep stopband rejection well past the cutoff.
    expect(response(h, 5.5e6)).toBeLessThan(0.02)
  })

  it('is linear-phase (symmetric taps)', () => {
    expect(isSymmetric(lowpass(4.2e6, 49))).toBe(true)
  })
})

describe('bandpass', () => {
  it('has unity gain at the center frequency', () => {
    const center = 3.579545e6
    const h = bandpass(center, 0.6e6, 55)
    expect(response(h, center)).toBeCloseTo(1, 1)
  })

  it('rejects DC and frequencies outside the passband', () => {
    const center = 3.579545e6
    const h = bandpass(center, 0.6e6, 55)
    expect(response(h, 0)).toBeLessThan(0.02)
    expect(response(h, center + 2e6)).toBeLessThan(0.1)
  })

  it('is linear-phase (symmetric taps)', () => {
    expect(isSymmetric(bandpass(3.579545e6, 0.6e6, 55))).toBe(true)
  })
})

describe('lowpassPeaked', () => {
  it('reduces to a plain lowpass when peak is zero', () => {
    const plain = lowpass(4.2e6, 49)
    const peaked = lowpassPeaked(4.2e6, 0, 3.15e6, 49)
    for (let k = 0; k < plain.length; k++)
      expect(peaked[k]).toBeCloseTo(plain[k], 12)
  })

  it('boosts high frequencies relative to the plain lowpass', () => {
    const plain = lowpass(4.2e6, 49)
    const peaked = lowpassPeaked(4.2e6, 1, 3.15e6, 49)
    // Peaking lifts the mid/high band where (delta - lp2) has its energy.
    expect(response(peaked, 3e6)).toBeGreaterThan(response(plain, 3e6))
  })

  it('preserves unity DC gain (peaking adds zero-DC content)', () => {
    const h = lowpassPeaked(4.2e6, 0.8, 3.15e6, 49)
    let sum = 0
    for (const v of h) sum += v
    expect(sum).toBeCloseTo(1, 6)
  })
})

describe('lowpassCausal', () => {
  it('has unity DC gain', () => {
    const h = lowpassCausal(0.6e6, 41)
    let sum = 0
    for (const v of h) sum += v
    expect(sum).toBeCloseTo(1, 6)
  })

  it('is one-sided (no leading taps past the center)', () => {
    const h = lowpassCausal(0.6e6, 41)
    const m = (41 - 1) / 2
    for (let k = m + 1; k < h.length; k++) expect(h[k]).toBe(0)
    // energy sits behind the center: peak tap is the center, tail decays back
    expect(h[m]).toBeGreaterThan(h[m - 1])
    expect(h[m - 1]).toBeGreaterThan(h[0])
  })

  it('low-passes: rejects above the cutoff', () => {
    expect(response(lowpassCausal(0.6e6, 41), 4e6)).toBeLessThan(0.2)
  })
})

describe('mixTaps', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    const a = lowpass(0.6e6, 41)
    const b = lowpassCausal(0.6e6, 41)
    const at0 = mixTaps(a, b, 0)
    const at1 = mixTaps(a, b, 1)
    for (let k = 0; k < a.length; k++) {
      expect(at0[k]).toBeCloseTo(a[k], 12)
      expect(at1[k]).toBeCloseTo(b[k], 12)
    }
  })

  it('preserves unity DC gain for a blend of unity-DC kernels', () => {
    const h = mixTaps(lowpass(0.6e6, 41), lowpassCausal(0.6e6, 41), 0.4)
    let sum = 0
    for (const v of h) sum += v
    expect(sum).toBeCloseTo(1, 6)
  })
})

describe('filter bank packing', () => {
  it('every kernel fits within its stride slot', () => {
    for (const [name, taps] of Object.entries(TAPS)) {
      expect(taps, `TAPS.${name} exceeds FILTER_STRIDE`).toBeLessThanOrEqual(
        FILTER_STRIDE,
      )
    }
  })

  it('places each section at its stride offset without bleeding into the next', () => {
    const a = lowpass(4.2e6, TAPS.luma)
    const b = bandpass(3.579545e6, 0.6e6, TAPS.chromaBp)
    const bank = packFilterBank(
      new Map([
        [0, a],
        [1, b],
      ]),
    )
    expect(Array.from(bank.subarray(0, a.length))).toEqual(Array.from(a))
    expect(
      Array.from(bank.subarray(FILTER_STRIDE, FILTER_STRIDE + b.length)),
    ).toEqual(Array.from(b))
    // Tail of slot 0 past the kernel must stay zero (no overrun from slot 1).
    for (let k = a.length; k < FILTER_STRIDE; k++) expect(bank[k]).toBe(0)
  })
})
