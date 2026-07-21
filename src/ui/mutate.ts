import type { Controls } from '../controls'
import type { SliderDef } from './controls'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Land on the slider's step grid, so mode-select controls (step 1) resolve to
// whole integers rather than a fractional index no shader branch expects.
const snap = (v: number, min: number, step: number) =>
  step > 0 ? min + Math.round((v - min) / step) * step : v

// Nudge every control by a random fraction of its own slider range — the
// bender's hand brushing all the pots at once. Jittering *around* the current
// look rather than picking fresh-random values keeps sync, colour, and geometry
// roughly intact, so the result reads as a variation worth keeping instead of
// the black-screen mush a full randomize usually collapses to.
export function mutate(
  controls: Controls,
  sliders: readonly SliderDef[],
  amt = 0.12,
  rand: () => number = Math.random,
): Controls {
  const next = { ...controls }
  for (const s of sliders) {
    const jitter = (rand() * 2 - 1) * amt * (s.max - s.min)
    next[s.key] = clamp(snap(controls[s.key] + jitter, s.min, s.step), s.min, s.max)
  }
  return next
}
