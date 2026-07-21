// Audio into the analog chain, in two forms, because they fail differently.
//
// `data` is one audio sample per line — a field is ~1/60 s over 525 lines, so
// audio at line rate lands about one sample per line and the waveform becomes
// horizontal displacement directly, the way a synth patched at the yoke does
// it. Honest, but a periodic sound draws a periodic shape: a sustained tone
// traces a clean sine down the raster and reads as a filter effect, not a fault.
//
// `level` and `hit` are envelopes for driving the *oscillators* instead —
// detuning vertical and horizontal hold so transients knock sync out and the
// picture lurches and tears back into lock. That path is far more interesting,
// because what you see is a system losing and regaining control rather than a
// waveform traced onto the picture. `hit` is an onset envelope, not a level, so
// it punches on each kick instead of riding the bassline.

import { LINES } from './constants'

// Quietest input the auto-gain will still normalize against. Below this it
// stops chasing the signal down, so silence stays silent.
const PEAK_FLOOR = 0.05
// Same idea for the onset detector's reference.
const HIT_FLOOR = 0.01
// Per-frame release of the hit envelope: ~0.2 s at 60 fps, so a kick punches
// and falls away rather than smearing into the next bar.
const HIT_RELEASE = 0.82

export interface HitState {
  hit: number
  lowPrev: number
  ref: number
}

// The smack is the *attack*, not the level. Tracking positive low-band flux
// means a sustained bassline sits still while each kick punches; track the level
// instead and a steady groove holds the picture open, which reads as a stuck
// effect rather than a hit. Instant attack, exponential release, normalized
// against the biggest recent onset so any material lands near 1.
export function stepHit(s: HitState, low: number): HitState {
  const flux = Math.max(0, low - s.lowPrev)
  const ref = Math.max(flux, s.ref * 0.995, HIT_FLOOR)
  return {
    hit: Math.min(Math.max(s.hit * HIT_RELEASE, flux / ref), 1.5),
    lowPrev: low,
    ref,
  }
}

export class AudioState {
  readonly data = new Float32Array(LINES)
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private scratch = new Float32Array(2048)
  private spectrum = new Float32Array(1024)
  private peak = PEAK_FLOOR
  private lowPrev = 0
  private hitRef = HIT_FLOOR
  private stream: MediaStream | null = null
  // Vaporwave media routing: a media element binds to one AudioContext for
  // life, so its source is created once and cached here, disconnected while
  // muted, and only evicted (releaseMedia) when the element is retired.
  private mediaSources = new Map<HTMLMediaElement, MediaElementAudioSourceNode>()
  private media: {
    ctx: AudioContext
    analyser: AnalyserNode
    wet: GainNode
    convolver: ConvolverNode
  } | null = null
  level = 0
  hit = 0

  get active(): boolean {
    return this.analyser !== null
  }

  // Own the given context and size the analysis buffers to it, shared by the
  // mic and media paths so the FFT size lives in one place.
  private initAnalyser(ctx: AudioContext): AnalyserNode {
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    this.ctx = ctx
    this.analyser = analyser
    this.scratch = new Float32Array(analyser.fftSize)
    this.spectrum = new Float32Array(analyser.frequencyBinCount)
    return analyser
  }

  private connect(make: (ctx: AudioContext) => AudioNode): void {
    this.disconnect()
    const ctx = new AudioContext()
    // Browsers hand back a suspended context unless creation is tied to a user
    // gesture; the enable button is one, but autoplay policies still vary, so
    // ask explicitly rather than silently analysing digital silence.
    void ctx.resume()
    make(ctx).connect(this.initAnalyser(ctx))
  }

  async enableMic(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.connect(ctx => ctx.createMediaStreamSource(stream))
    this.stream = stream
  }

  // A short decaying-noise impulse — a plausible hall tail for the reverb send.
  private impulse(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 2.5)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
      }
    }
    return buf
  }

  // Build the media graph once (a mic context is mutually exclusive, so it's
  // dropped first) and reuse it: convolver → wet → speakers is the reverb send,
  // and sources also feed the analyser so the slowed track drives the artifacts.
  private ensureMedia(): NonNullable<AudioState['media']> {
    if (this.media === null) {
      this.disconnect()
      const ctx = new AudioContext()
      const analyser = this.initAnalyser(ctx)
      const wet = ctx.createGain()
      const convolver = ctx.createConvolver()
      convolver.buffer = this.impulse(ctx)
      convolver.connect(wet).connect(ctx.destination)
      this.media = { ctx, analyser, wet, convolver }
    }
    return this.media
  }

  // Route the given media elements' audio to the speakers and reverb send.
  // Passing [] silences the graph but keeps the context and its per-element
  // sources alive — a media element binds to one context for life, so tearing
  // it down would strand elements still on screen. disconnect() truly closes it.
  routeMedia(els: HTMLMediaElement[], reverb: number): void {
    if (els.length > 0 || this.media !== null) {
      const m = this.ensureMedia()
      void m.ctx.resume()
      for (const src of this.mediaSources.values()) src.disconnect()
      for (const el of els) {
        const src = this.mediaSources.get(el) ?? m.ctx.createMediaElementSource(el)
        this.mediaSources.set(el, src)
        src.connect(m.ctx.destination)
        src.connect(m.analyser)
        src.connect(m.convolver)
      }
      m.wet.gain.value = reverb
    }
  }

  setReverbMix(reverb: number): void {
    if (this.media !== null) this.media.wet.gain.value = reverb
  }

  // Drop an element's source when its <video> is retired for good (a new clip
  // is a new element). Muting keeps a source cached — an element binds to one
  // context for life and can't be re-adopted — so only true retirement evicts,
  // which is why the element's owner has to signal it rather than routeMedia.
  releaseMedia(el: HTMLMediaElement): void {
    this.mediaSources.get(el)?.disconnect()
    this.mediaSources.delete(el)
  }

  disconnect(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop()
    this.stream = null
    void this.ctx?.close()
    this.ctx = null
    this.analyser = null
    // Sources belong to the closed context; drop them so a later routeMedia
    // rebuilds fresh ones rather than reusing nodes from a dead graph.
    this.mediaSources.clear()
    this.media = null
    this.data.fill(0)
    this.level = 0
    this.hit = 0
    this.peak = PEAK_FLOOR
    this.lowPrev = 0
    this.hitRef = HIT_FLOOR
  }

  // Resample the most recent field's worth of audio down to one sample per
  // line, normalized against a slowly-decaying peak so any input level is
  // usable without riding a gain slider.
  update(gain: number): Float32Array<ArrayBuffer> {
    const an = this.analyser
    if (an === null) return this.data
    an.getFloatTimeDomainData(this.scratch)
    const ctx = this.ctx
    const field = ctx === null ? 735 : Math.round(ctx.sampleRate / 60)
    const span = Math.min(this.scratch.length, field)
    const start = this.scratch.length - span

    let hi = 0
    let sum = 0
    for (let row = 0; row < LINES; row++) {
      const v = this.scratch[start + Math.floor((row / LINES) * span)]
      this.data[row] = v
      hi = Math.max(hi, Math.abs(v))
      sum += v * v
    }
    // Fast attack, slow release, and a hard floor on the reference. Without the
    // floor a quiet passage lets the divisor decay toward zero and the gain
    // runs away, so room noise gets amplified to full-scale deflection and the
    // picture detonates — the auto-gain has to give up rather than chase
    // silence. Deflection is then clamped, so no input can drive it past the
    // range the sliders describe.
    this.peak = Math.max(hi, this.peak * 0.995, PEAK_FLOOR)
    const norm = gain / this.peak
    for (let row = 0; row < LINES; row++) {
      this.data[row] = Math.max(-2, Math.min(2, this.data[row] * norm))
    }
    this.level = Math.min(Math.sqrt(sum / LINES) / this.peak, 2)
    this.updateHit()
    return this.data
  }

  private updateHit(): void {
    const next = stepHit(
      { hit: this.hit, lowPrev: this.lowPrev, ref: this.hitRef },
      this.lowEnergy(),
    )
    this.hit = next.hit
    this.lowPrev = next.lowPrev
    this.hitRef = next.ref
  }

  // Mean magnitude below ~200 Hz: kick and bass, where the punch lives.
  private lowEnergy(): number {
    const an = this.analyser
    let acc = 0
    if (an !== null && this.ctx !== null) {
      an.getFloatFrequencyData(this.spectrum)
      const hz = this.ctx.sampleRate / 2 / this.spectrum.length
      const bins = Math.max(1, Math.round(200 / hz))
      for (let i = 0; i < bins; i++) {
        // dB (-Inf..0) to a 0..1 weighting over the bottom 60 dB
        acc += Math.max(0, (this.spectrum[i] + 60) / 60)
      }
      acc /= bins
    }
    return acc
  }
}
