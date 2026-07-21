import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTROLS } from '../controls'
import { PRESETS, blendPresets, matchPreset, presetControls } from './presets'

describe('blendPresets', () => {
  it('at full weight over defaults, reproduces the preset exactly', () => {
    for (const p of PRESETS) {
      const blended = blendPresets(DEFAULT_CONTROLS, new Map([[p.name, 1]]))
      expect(blended, p.name).toEqual(presetControls(p.patch))
      expect(matchPreset(blended)?.name).toBe(p.name)
    }
  })

  it('at zero weight, leaves the baseline untouched', () => {
    const base = presetControls({ noiseIre: 7, cfbMix: 0.4 })
    expect(
      blendPresets(
        base,
        new Map([
          ['vhs', 0],
          ['neon tube', 0],
        ]),
      ),
    ).toEqual(base)
  })

  it('halves a fault at half weight', () => {
    const half = blendPresets(DEFAULT_CONTROLS, new Map([['broadcast', 0.5]]))
    expect(half.ghostGain).toBe(0.05)
    expect(half.noiseIre).toBe(0.6)
  })

  it('accumulates grain across stacked presets instead of clobbering it', () => {
    const worn = presetControls({ noiseIre: 7 })
    expect(blendPresets(worn, new Map([['round tube', 1]])).noiseIre).toBe(7)
    expect(blendPresets(worn, new Map([['mixer loop', 1]])).noiseIre).toBe(8.5)
  })

  it('picks one mode rather than averaging enum controls', () => {
    const mixed = blendPresets(
      DEFAULT_CONTROLS,
      new Map([
        ['round tube', 0.4],
        ['green terminal', 0.6],
      ]),
    )
    expect(mixed.phosphorMode).toBe(3)
    expect(
      blendPresets(
        DEFAULT_CONTROLS,
        new Map([
          ['round tube', 0.6],
          ['green terminal', 0.4],
        ]),
      ).phosphorMode,
    ).toBe(2)
  })

  it('clamps a summed fault to the slider range', () => {
    const piled = blendPresets(
      DEFAULT_CONTROLS,
      new Map([
        ['dead channel', 1],
        ['worn tape', 1],
        ['mistuned rf', 1],
      ]),
    )
    expect(piled.noiseIre).toBeLessThanOrEqual(40)
  })
})
