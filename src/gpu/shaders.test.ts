// Static WGSL validation. Every shader is only compiled at runtime inside the
// browser's WebGPU implementation, so a typo survives until the app runs. Here
// we prepend the same generated PRELUDE the engine uses and hand each shader to
// naga (the wgpu validator) for a real type/borrow/entry-point check at test
// time. Naga is a Rust binary; if it isn't on PATH the suite skips locally but
// CI installs it, so the check is enforced there.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRELUDE } from './prelude'
import channel from './shaders/channel.wgsl?raw'
import chromaExtract from './shaders/chroma_extract.wgsl?raw'
import compose from './shaders/compose.wgsl?raw'
import crtFace from './shaders/crt_face.wgsl?raw'
import decode from './shaders/decode.wgsl?raw'
import encodeComposite from './shaders/encode_composite.wgsl?raw'
import encodeYuv from './shaders/encode_yuv.wgsl?raw'
import fbComposite from './shaders/fb_composite.wgsl?raw'
import lineAnalyze from './shaders/line_analyze.wgsl?raw'
import mixB from './shaders/mix_b.wgsl?raw'
import present from './shaders/present.wgsl?raw'
import storePrev from './shaders/store_prev.wgsl?raw'
import sync from './shaders/sync.wgsl?raw'
import syncMeasure from './shaders/sync_measure.wgsl?raw'
import timebase from './shaders/timebase.wgsl?raw'
import underDown from './shaders/under_down.wgsl?raw'

const SHADERS: Record<string, string> = {
  channel,
  chroma_extract: chromaExtract,
  compose,
  crt_face: crtFace,
  decode,
  encode_composite: encodeComposite,
  encode_yuv: encodeYuv,
  fb_composite: fbComposite,
  line_analyze: lineAnalyze,
  mix_b: mixB,
  present,
  store_prev: storePrev,
  sync,
  sync_measure: syncMeasure,
  timebase,
  under_down: underDown,
}

const hasNaga = ((): boolean => {
  try {
    execFileSync('naga', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const dir = hasNaga ? mkdtempSync(join(tmpdir(), 'wgsl-')) : ''

describe('WGSL shaders pass naga validation', () => {
  it('naga must be installed under CI', () => {
    // Locally naga is optional and the per-shader checks below skip without it.
    // CI installs it, so a missing binary there would silently skip the whole
    // validation — fail loudly instead of passing a green build that checked
    // nothing.
    if (process.env.CI !== undefined)
      expect(hasNaga, 'naga not found on PATH in CI').toBe(true)
  })

  for (const [name, src] of Object.entries(SHADERS)) {
    it.runIf(hasNaga)(name, () => {
      const file = join(dir, `${name}.wgsl`)
      writeFileSync(file, PRELUDE + src)
      // naga exits non-zero and prints a diagnostic on any validation error;
      // surface that text in the assertion when it throws.
      try {
        execFileSync('naga', [file], { stdio: 'pipe' })
      } catch (e) {
        const err = e as { stderr?: Buffer; stdout?: Buffer }
        expect.fail(
          `${name}.wgsl failed naga validation:\n${err.stderr ?? ''}${err.stdout ?? ''}`,
        )
      }
    })
  }
})
