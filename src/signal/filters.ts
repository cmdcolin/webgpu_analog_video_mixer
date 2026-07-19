// Windowed-sinc FIR design. Every filter in the signal path is designed here
// from real frequency specs and uploaded to the GPU as taps — no ad-hoc blurs.

import { SAMPLE_RATE } from './constants'

// Blackman window: good stopband for short kernels, modest transition width.
function blackman(k: number, taps: number): number {
  const x = (2 * Math.PI * k) / (taps - 1)
  return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x)
}

// Unity DC gain lowpass.
export function lowpass(cutoffHz: number, taps: number): Float32Array {
  const m = (taps - 1) / 2
  const fc = cutoffHz / SAMPLE_RATE
  const h = new Float32Array(taps)
  let sum = 0
  for (let k = 0; k < taps; k++) {
    const n = k - m
    const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n)
    h[k] = sinc * blackman(k, taps)
    sum += h[k]
  }
  for (let k = 0; k < taps; k++) h[k] = h[k] / sum
  return h
}

// Unity center gain bandpass (lowpass heterodyned to centerHz).
export function bandpass(centerHz: number, halfWidthHz: number, taps: number): Float32Array {
  const lp = lowpass(halfWidthHz, taps)
  const m = (taps - 1) / 2
  const w = (2 * Math.PI * centerHz) / SAMPLE_RATE
  const h = new Float32Array(taps)
  for (let k = 0; k < taps; k++) h[k] = 2 * lp[k] * Math.cos(w * (k - m))
  return h
}

// Lowpass with high-frequency peaking mixed in: delta + peak*(delta - lp2).
// Models the luma "sharpness" boost of tape decks -> edge overshoot and ringing.
export function lowpassPeaked(cutoffHz: number, peak: number, peakHz: number, taps: number): Float32Array {
  const lp = lowpass(cutoffHz, taps)
  const lp2 = lowpass(peakHz, taps)
  const m = (taps - 1) / 2
  const h = new Float32Array(taps)
  for (let k = 0; k < taps; k++) {
    const delta = k === m ? 1 : 0
    h[k] = lp[k] + peak * (delta - lp2[k])
  }
  return h
}

// Fixed kernel lengths per section, baked into the WGSL prelude as constants
// so every convolution loop has a compile-time trip count and can unroll.
export const TAPS = {
  encChroma: 33,
  demod: 41,
  luma: 49,
  chromaBp: 55,
  under: 55,
}

// The GPU filter bank: fixed-stride sections so shaders index kernels by slot.
export const FILTER_STRIDE = 64
export const SEC_ENC_CHROMA = 0 // encoder I/Q (U/V) bandlimit
export const SEC_DEMOD = 1 // decoder chroma demod lowpass
export const SEC_LUMA = 2 // channel/tape luma bandwidth (with peaking)
export const SEC_CHROMA_BP = 3 // chroma extraction bandpass at fsc
export const SEC_UNDER = 4 // color-under lowpass after down-conversion
export const NUM_SECTIONS = 5

export function packFilterBank(sections: Map<number, Float32Array>): Float32Array<ArrayBuffer> {
  const bank = new Float32Array(NUM_SECTIONS * FILTER_STRIDE)
  for (const [sec, taps] of sections) bank.set(taps, sec * FILTER_STRIDE)
  return bank
}
