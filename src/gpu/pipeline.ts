import { ACTIVE_HEIGHT, ACTIVE_WIDTH, LINES, SAMPLES_PER_LINE, SAMPLE_RATE } from '../signal/constants'
import {
  FILTER_STRIDE,
  NUM_SECTIONS,
  SEC_CHROMA_BP,
  SEC_DEMOD,
  SEC_ENC_CHROMA,
  SEC_LUMA,
  SEC_UNDER,
  bandpass,
  lowpass,
  lowpassPeaked,
  packFilterBank,
} from '../signal/filters'
import { FSC } from '../signal/constants'
import { LineState } from '../signal/linestate'
import { MixState } from '../signal/mixstate'
import type { Gpu } from './context'
import { initGpu } from './context'
import { PARAM_BYTES, PRELUDE, packParams } from './prelude'
import channelSrc from './shaders/channel.wgsl?raw'
import chromaExtractSrc from './shaders/chroma_extract.wgsl?raw'
import composeSrc from './shaders/compose.wgsl?raw'
import decodeSrc from './shaders/decode.wgsl?raw'
import timebaseSrc from './shaders/timebase.wgsl?raw'
import underDownSrc from './shaders/under_down.wgsl?raw'
import encodeCompositeSrc from './shaders/encode_composite.wgsl?raw'
import encodeYuvSrc from './shaders/encode_yuv.wgsl?raw'
import fbCompositeSrc from './shaders/fb_composite.wgsl?raw'
import lineAnalyzeSrc from './shaders/line_analyze.wgsl?raw'
import mixBSrc from './shaders/mix_b.wgsl?raw'
import presentSrc from './shaders/present.wgsl?raw'
import storePrevSrc from './shaders/store_prev.wgsl?raw'
import syncSrc from './shaders/sync.wgsl?raw'

const N = SAMPLES_PER_LINE * LINES

// All user-facing controls, in physical units.
export const DEFAULT_CONTROLS = {
  // encoder
  encChromaMHz: 1.3,
  // decoder
  demodMHz: 0.6,
  chromaGain: 1,
  burstLock: 1,
  killThresh: 2, // IRE
  combMode: 0,
  hHold: 0.35,
  vHold: 1,
  // channel / tape
  lumaMHz: 4.2,
  lumaPeak: 0,
  noiseIre: 0,
  soundIre: 0,
  agc: 0,
  ghostDelayUs: 0,
  ghostGain: 0,
  humAmp: 0,
  colorUnderMix: 0,
  underJitterDeg: 0,
  dropoutRate: 0,
  dropoutLenUs: 5,
  headSwitchNoise: 0,
  headSwitchShiftUs: 0,
  tbJitterNs: 0,
  tbWowNs: 0,
  // feedback
  fbMix: 0,
  fbZoom: 1.05,
  fbRotateDeg: 0,
  fbShiftX: 0,
  fbShiftY: 0,
  fbGain: 1,
  fbFocus: 0.7,
  fbVign: 0.2,
  fbBlack: 0.03,
  fbKnee: 0.35,
  // mixer loop (composite-level feedback)
  cfbMix: 0,
  cfbGain: 1,
  cfbDelayUs: 0.15,
  cfbLines: 0,
  cfbKey: 0,
  cfbKeyLevel: 45,
  cfbKeySoft: 8,
  cfbHold: 0,
  cfbTrail: 0,
  // dirty mixer (source B, non-genlocked)
  bGain: 0,
  bRing: 0,
  bLineHz: 0.15,
  bDetuneHz: 40,
  bRollLps: 0.1,
  bHueDeg: 0,
  bVidGain: 1,
  bInv: 0,
  wipeMode: 0,
  wipePos: 0.5,
  wipeSoft: 0.05,
  wipeRate: 0,
  // display
  scanBeam: 0.3,
}

export type Controls = typeof DEFAULT_CONTROLS
export type ControlKey = keyof Controls

const FILTER_KEYS: ReadonlySet<string> = new Set(['encChromaMHz', 'demodMHz', 'lumaMHz', 'lumaPeak'])

const TAPS = {
  encChromaTaps: 33,
  demodTaps: 41,
  lumaTaps: 49,
  chromaBpTaps: 55,
  underTaps: 55,
}

export class Engine {
  readonly controls: Controls = { ...DEFAULT_CONTROLS }
  onStats: (fps: number) => void = () => {}
  onDeviceLost: (message: string) => void = () => {}

  // Parsed once: the debug view can't change without a reload.
  private readonly dbgView = Number(new URLSearchParams(location.search).get('dbg') ?? 0)

  private gpu: Gpu
  private canvas: HTMLCanvasElement
  private frame = 0
  private filtersDirty = true
  private running = true
  private lineState = new LineState()
  private mixState = new MixState()
  private paramScratch = new ArrayBuffer(PARAM_BYTES)
  private lastTime = 0
  private frameAcc = 0
  private frameCount = 0
  private rafId = 0

  private paramsBuf: GPUBuffer
  private filterBuf: GPUBuffer
  private yuvBuf: GPUBuffer
  private yuvBBuf: GPUBuffer
  private compA: GPUBuffer
  private compB: GPUBuffer
  private compPrev: GPUBuffer
  private chromaBuf: GPUBuffer
  private underBuf: GPUBuffer
  private lineInfoBuf: GPUBuffer
  private lineParamsBuf: GPUBuffer
  private timingBuf: GPUBuffer

  private srcTex: GPUTexture
  private srcAspect = 4 / 3
  private videoEl: HTMLVideoElement | null = null
  // Firefox's copyExternalImageToTexture rejects HTMLVideoElement; stage video
  // frames through a 2D canvas.
  private videoStage: OffscreenCanvas | null = null
  // source B is always staged at raster size (cover-fit on the CPU), so its
  // texture and bind groups are fixed
  private srcTexB: GPUTexture
  private videoElB: HTMLVideoElement | null = null
  private stageB: OffscreenCanvas | null = null
  private bEnabled = true
  private inputTex: GPUTexture
  private outTex: GPUTexture
  private linearSamp: GPUSampler

  private composePl: GPUComputePipeline
  private encodeYuvPl: GPUComputePipeline
  private encodeCompositePl: GPUComputePipeline
  private chromaExtractPl: GPUComputePipeline
  private underDownPl: GPUComputePipeline
  private mixBPl: GPUComputePipeline
  private fbCompositePl: GPUComputePipeline
  private storePrevPl: GPUComputePipeline
  private channelPl: GPUComputePipeline
  private timebasePl: GPUComputePipeline
  private syncPl: GPUComputePipeline
  private lineAnalyzePl: GPUComputePipeline
  private decodePl: GPUComputePipeline
  private presentPl: GPURenderPipeline

  private composeBg: GPUBindGroup
  private encodeYuvBg: GPUBindGroup
  private encodeYuvBBg: GPUBindGroup
  private mixBBg: GPUBindGroup
  private fbCompositeBg: GPUBindGroup
  private storePrevBg: GPUBindGroup
  private encodeCompositeBg: GPUBindGroup
  private chromaExtractBg: GPUBindGroup
  private underDownBg: GPUBindGroup
  private channelBg: GPUBindGroup
  private timebaseBg: GPUBindGroup
  private syncBg: GPUBindGroup
  private lineAnalyzeBg: GPUBindGroup
  private decodeBg: GPUBindGroup
  private presentBg: GPUBindGroup

  static async create(canvas: HTMLCanvasElement): Promise<Engine> {
    const gpu = await initGpu(canvas)
    return new Engine(gpu, canvas)
  }

  private constructor(gpu: Gpu, canvas: HTMLCanvasElement) {
    this.gpu = gpu
    this.canvas = canvas
    const d = gpu.device

    this.paramsBuf = d.createBuffer({ size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.filterBuf = d.createBuffer({
      size: NUM_SECTIONS * FILTER_STRIDE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.yuvBuf = d.createBuffer({ size: N * 16, usage: GPUBufferUsage.STORAGE })
    this.yuvBBuf = d.createBuffer({ size: N * 16, usage: GPUBufferUsage.STORAGE })
    this.compA = d.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    this.compB = d.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE })
    this.compPrev = d.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.chromaBuf = d.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE })
    this.underBuf = d.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE })
    this.lineInfoBuf = d.createBuffer({ size: LINES * 16, usage: GPUBufferUsage.STORAGE })
    this.lineParamsBuf = d.createBuffer({ size: LINES * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.timingBuf = d.createBuffer({ size: (LINES + 3) * 4, usage: GPUBufferUsage.STORAGE })

    const texDesc = (usage: number): GPUTextureDescriptor => ({
      size: [ACTIVE_WIDTH, ACTIVE_HEIGHT],
      format: 'rgba8unorm',
      usage,
    })
    this.srcTex = d.createTexture(
      texDesc(GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT),
    )
    this.srcTexB = d.createTexture(
      texDesc(GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT),
    )
    this.inputTex = d.createTexture(texDesc(GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING))
    this.outTex = d.createTexture(texDesc(GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING))
    this.linearSamp = d.createSampler({ magFilter: 'linear', minFilter: 'linear' })

    const module = (src: string) => {
      const m = d.createShaderModule({ code: PRELUDE + src })
      m.getCompilationInfo().then((info) => {
        for (const msg of info.messages) {
          if (msg.type === 'error') console.error(`WGSL ${msg.lineNum}:${msg.linePos} ${msg.message}`)
        }
      })
      return m
    }
    const compute = (src: string) =>
      d.createComputePipeline({
        layout: 'auto',
        compute: { module: module(src), entryPoint: 'main' },
      })
    this.composePl = compute(composeSrc)
    this.encodeYuvPl = compute(encodeYuvSrc)
    this.encodeCompositePl = compute(encodeCompositeSrc)
    this.mixBPl = compute(mixBSrc)
    this.fbCompositePl = compute(fbCompositeSrc)
    this.storePrevPl = compute(storePrevSrc)
    this.chromaExtractPl = compute(chromaExtractSrc)
    this.underDownPl = compute(underDownSrc)
    this.channelPl = compute(channelSrc)
    this.timebasePl = compute(timebaseSrc)
    this.syncPl = compute(syncSrc)
    this.lineAnalyzePl = compute(lineAnalyzeSrc)
    this.decodePl = compute(decodeSrc)

    const presentModule = module(presentSrc)
    this.presentPl = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: presentModule, entryPoint: 'vs' },
      fragment: { module: presentModule, entryPoint: 'fs', targets: [{ format: gpu.format }] },
      primitive: { topology: 'triangle-list' },
    })

    const bg = (pl: GPUComputePipeline | GPURenderPipeline, entries: Array<GPUBindingResource>) =>
      d.createBindGroup({
        layout: pl.getBindGroupLayout(0),
        entries: entries.map((resource, binding) => ({ binding, resource })),
      })
    this.composeBg = this.makeComposeBg()
    this.encodeYuvBg = bg(this.encodeYuvPl, [this.inputTex.createView(), this.linearSamp, { buffer: this.yuvBuf }])
    this.encodeYuvBBg = bg(this.encodeYuvPl, [this.srcTexB.createView(), this.linearSamp, { buffer: this.yuvBBuf }])
    this.mixBBg = bg(this.mixBPl, [
      { buffer: this.paramsBuf },
      { buffer: this.filterBuf },
      { buffer: this.yuvBBuf },
      { buffer: this.compA },
    ])
    this.fbCompositeBg = bg(this.fbCompositePl, [
      { buffer: this.paramsBuf },
      { buffer: this.compPrev },
      { buffer: this.compA },
    ])
    this.storePrevBg = bg(this.storePrevPl, [
      { buffer: this.paramsBuf },
      { buffer: this.compA },
      { buffer: this.compPrev },
    ])
    this.encodeCompositeBg = bg(this.encodeCompositePl, [
      { buffer: this.paramsBuf },
      { buffer: this.filterBuf },
      { buffer: this.yuvBuf },
      { buffer: this.compA },
    ])
    this.chromaExtractBg = bg(this.chromaExtractPl, [
      { buffer: this.paramsBuf },
      { buffer: this.filterBuf },
      { buffer: this.compA },
      { buffer: this.chromaBuf },
    ])
    this.underDownBg = bg(this.underDownPl, [
      { buffer: this.paramsBuf },
      { buffer: this.filterBuf },
      { buffer: this.chromaBuf },
      { buffer: this.lineParamsBuf },
      { buffer: this.underBuf },
    ])
    this.channelBg = bg(this.channelPl, [
      { buffer: this.paramsBuf },
      { buffer: this.filterBuf },
      { buffer: this.compA },
      { buffer: this.chromaBuf },
      { buffer: this.underBuf },
      { buffer: this.lineParamsBuf },
      { buffer: this.compB },
    ])
    this.timebaseBg = bg(this.timebasePl, [
      { buffer: this.lineParamsBuf },
      { buffer: this.compB },
      { buffer: this.compA },
    ])
    this.syncBg = bg(this.syncPl, [{ buffer: this.paramsBuf }, { buffer: this.compA }, { buffer: this.timingBuf }])
    this.lineAnalyzeBg = bg(this.lineAnalyzePl, [
      { buffer: this.paramsBuf },
      { buffer: this.compA },
      { buffer: this.timingBuf },
      { buffer: this.lineInfoBuf },
    ])
    this.decodeBg = bg(this.decodePl, [
      { buffer: this.paramsBuf },
      { buffer: this.filterBuf },
      { buffer: this.compA },
      { buffer: this.lineInfoBuf },
      { buffer: this.timingBuf },
      this.outTex.createView(),
    ])
    this.presentBg = bg(this.presentPl, [{ buffer: this.paramsBuf }, this.outTex.createView(), this.linearSamp])

    // reason 'destroyed' is our own destroy(); anything else is a real loss
    // (driver reset, sleep/wake, GPU hang) — stop and surface it.
    this.gpu.device.lost.then((info) => {
      if (this.running && info.reason !== 'destroyed') {
        this.running = false
        this.onDeviceLost(info.message)
      }
    })
    this.rafId = requestAnimationFrame(this.tick)
  }

  setControl(key: ControlKey, value: number): void {
    this.controls[key] = value
    if (FILTER_KEYS.has(key)) this.filtersDirty = true
  }

  applyControls(patch: Partial<Controls>): void {
    for (const [k, v] of Object.entries(patch)) this.setControl(k as ControlKey, v)
  }

  // Patterns are drawn on the signal raster (non-square pixels): aspect is 4:3.
  setImageSource(source: OffscreenCanvas | ImageBitmap, aspect = 4 / 3): void {
    this.videoEl = null
    this.ensureSrcTex(source.width, source.height, aspect)
    this.gpu.device.queue.copyExternalImageToTexture({ source, flipY: false }, { texture: this.srcTex }, [
      source.width,
      source.height,
    ])
  }

  setVideoSource(el: HTMLVideoElement | null): void {
    this.videoEl = el
  }

  setImageSourceB(source: OffscreenCanvas | ImageBitmap): void {
    this.videoElB = null
    this.uploadB(source, source.width, source.height)
  }

  setVideoSourceB(el: HTMLVideoElement | null): void {
    this.videoElB = el
  }

  setSourceBEnabled(on: boolean): void {
    this.bEnabled = on
  }

  // B is staged to raster size with a centered 4:3 cover-fit crop, so the
  // mixer shader needs no aspect handling.
  private uploadB(source: OffscreenCanvas | ImageBitmap | HTMLVideoElement, w: number, h: number): void {
    const d = this.gpu.device
    if (w === ACTIVE_WIDTH && h === ACTIVE_HEIGHT && !(source instanceof HTMLVideoElement)) {
      d.queue.copyExternalImageToTexture({ source, flipY: false }, { texture: this.srcTexB }, [w, h])
    } else {
      if (this.stageB === null) this.stageB = new OffscreenCanvas(ACTIVE_WIDTH, ACTIVE_HEIGHT)
      const g = this.stageB.getContext('2d')
      if (g) {
        const wide = w / h > 4 / 3
        const sw = wide ? h * (4 / 3) : w
        const sh = wide ? h : w * (3 / 4)
        g.drawImage(source, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, ACTIVE_WIDTH, ACTIVE_HEIGHT)
        d.queue.copyExternalImageToTexture({ source: this.stageB, flipY: false }, { texture: this.srcTexB }, [
          ACTIVE_WIDTH,
          ACTIVE_HEIGHT,
        ])
      }
    }
  }

  // srcTex is the only bind group that changes when the source raster resizes.
  private makeComposeBg(): GPUBindGroup {
    return this.gpu.device.createBindGroup({
      layout: this.composePl.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: this.srcTex.createView() },
        { binding: 2, resource: this.outTex.createView() },
        { binding: 3, resource: this.linearSamp },
        { binding: 4, resource: this.inputTex.createView() },
      ],
    })
  }

  private ensureSrcTex(w: number, h: number, aspect: number): void {
    this.srcAspect = aspect
    if (this.srcTex.width !== w || this.srcTex.height !== h) {
      this.srcTex.destroy()
      this.srcTex = this.gpu.device.createTexture({
        size: [w, h],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      this.composeBg = this.makeComposeBg()
    }
  }

  destroy(): void {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.rafId)
    const bufs = [
      this.paramsBuf,
      this.filterBuf,
      this.yuvBuf,
      this.yuvBBuf,
      this.compA,
      this.compB,
      this.compPrev,
      this.chromaBuf,
      this.underBuf,
      this.lineInfoBuf,
      this.lineParamsBuf,
      this.timingBuf,
    ]
    for (const b of bufs) b.destroy()
    for (const t of [this.srcTex, this.srcTexB, this.inputTex, this.outTex]) t.destroy()
    // Frees everything else the device owns (pipelines, bind groups) and drops
    // the swap-chain configuration.
    this.gpu.device.destroy()
  }

  // Manual frame step for the verification harness (rAF is throttled in
  // occluded windows).
  step(): void {
    this.render()
  }

  private rebuildFilters(): void {
    const c = this.controls
    const bank = packFilterBank(
      new Map([
        [SEC_ENC_CHROMA, lowpass(c.encChromaMHz * 1e6, TAPS.encChromaTaps)],
        [SEC_DEMOD, lowpass(c.demodMHz * 1e6, TAPS.demodTaps)],
        [SEC_LUMA, lowpassPeaked(c.lumaMHz * 1e6, c.lumaPeak, c.lumaMHz * 0.75e6, TAPS.lumaTaps)],
        [SEC_CHROMA_BP, bandpass(FSC, 0.6e6, TAPS.chromaBpTaps)],
        [SEC_UNDER, lowpass(1.2e6, TAPS.underTaps)],
      ]),
    )
    this.gpu.device.queue.writeBuffer(this.filterBuf, 0, bank)
    this.filtersDirty = false
  }

  private uniformValues(): Record<string, number> {
    const c = this.controls
    return {
      frame: this.frame,
      ...TAPS,
      canvasW: this.canvas.width,
      canvasH: this.canvas.height,
      srcAspect: this.srcAspect,
      chromaGain: c.chromaGain,
      burstLock: c.burstLock,
      killThresh: c.killThresh,
      combMode: c.combMode,
      hHold: c.hHold,
      vHold: c.vHold,
      noiseSigma: c.noiseIre,
      ghostDelay: c.ghostDelayUs * 1e-6 * SAMPLE_RATE,
      ghostGain: c.ghostGain,
      humAmp: c.humAmp,
      colorUnderMix: c.colorUnderMix,
      dropoutRate: c.dropoutRate,
      dropoutLen: c.dropoutLenUs * 1e-6 * SAMPLE_RATE,
      headSwitchNoise: c.headSwitchNoise,
      fbMix: c.fbMix,
      fbZoom: c.fbZoom,
      fbRotate: (c.fbRotateDeg * Math.PI) / 180,
      fbShiftX: c.fbShiftX,
      fbShiftY: c.fbShiftY,
      fbGain: c.fbGain,
      fbFocus: c.fbFocus,
      fbVign: c.fbVign,
      fbBlack: c.fbBlack,
      fbKnee: c.fbKnee,
      bGain: c.bGain,
      bRing: c.bRing,
      bHue: (c.bHueDeg * Math.PI) / 180,
      bVidGain: c.bVidGain,
      bInv: c.bInv,
      wipeMode: c.wipeMode,
      wipeSoft: c.wipeSoft,
      cfbMix: c.cfbMix,
      cfbGain: c.cfbGain,
      cfbDelay: c.cfbDelayUs * 1e-6 * SAMPLE_RATE,
      cfbLines: c.cfbLines,
      cfbKey: c.cfbKey,
      cfbKeyLevel: c.cfbKeyLevel,
      cfbKeySoft: c.cfbKeySoft,
      cfbTrail: c.cfbTrail,
      soundIre: c.soundIre,
      agc: c.agc,
      scanBeam: c.scanBeam,
      dbgView: this.dbgView,
    }
  }

  private tick = (time: number): void => {
    if (this.running) {
      if (this.lastTime > 0) {
        this.frameAcc += time - this.lastTime
        this.frameCount += 1
        if (this.frameCount === 30) {
          this.onStats(1000 / (this.frameAcc / 30))
          this.frameAcc = 0
          this.frameCount = 0
        }
      }
      this.lastTime = time
      this.render()
      this.rafId = requestAnimationFrame(this.tick)
    }
  }

  private render(): void {
    const d = this.gpu.device
    if (this.frame % 30 === 0 && location.search.includes('debug')) {
      console.log('DEBUG render frame', this.frame, 'video?', this.videoEl !== null, this.videoEl?.readyState)
    }
    if (this.videoEl !== null && this.videoEl.readyState >= 2) {
      const w = this.videoEl.videoWidth
      const h = this.videoEl.videoHeight
      if (w > 0) {
        this.ensureSrcTex(w, h, w / h)
        if (this.videoStage === null || this.videoStage.width !== w || this.videoStage.height !== h) {
          this.videoStage = new OffscreenCanvas(w, h)
        }
        const g = this.videoStage.getContext('2d')
        if (g) {
          g.drawImage(this.videoEl, 0, 0)
          if (this.frame % 30 === 0 && location.search.includes('debug')) {
            const px = g.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data
            console.log('DEBUG stage px', px[0], px[1], px[2], 'video t', this.videoEl.currentTime.toFixed(2))
          }
          d.queue.copyExternalImageToTexture(
            { source: this.videoStage, flipY: false },
            { texture: this.srcTex },
            [w, h],
          )
        }
      }
    }
    const vb = this.videoElB
    if (vb !== null && vb.readyState >= 2 && vb.videoWidth > 0) {
      this.uploadB(vb, vb.videoWidth, vb.videoHeight)
    }
    if (this.filtersDirty) this.rebuildFilters()
    const c = this.controls
    const mixU = this.mixState.update({
      bLineHz: c.bLineHz,
      bDetuneHz: c.bDetuneHz,
      bRollLps: c.bRollLps,
      wipePos: c.wipePos,
      wipeRateHz: c.wipeRate,
    })
    packParams({ ...this.uniformValues(), ...mixU }, this.paramScratch)
    d.queue.writeBuffer(this.paramsBuf, 0, this.paramScratch)
    d.queue.writeBuffer(
      this.lineParamsBuf,
      0,
      this.lineState.update(
        {
          tbJitterNs: c.tbJitterNs,
          tbWowNs: c.tbWowNs,
          underJitterDeg: c.underJitterDeg,
          headSwitchShiftUs: c.headSwitchShiftUs,
        },
        this.frame,
      ),
    )

    const enc = d.createCommandEncoder()
    const pass = enc.beginComputePass()
    const run = (pl: GPUComputePipeline, bgr: GPUBindGroup, x: number, y: number) => {
      pass.setPipeline(pl)
      pass.setBindGroup(0, bgr)
      pass.dispatchWorkgroups(x, y)
    }
    run(this.composePl, this.composeBg, Math.ceil(ACTIVE_WIDTH / 8), Math.ceil(ACTIVE_HEIGHT / 8))
    run(this.encodeYuvPl, this.encodeYuvBg, Math.ceil(ACTIVE_WIDTH / 64), ACTIVE_HEIGHT)
    run(this.encodeCompositePl, this.encodeCompositeBg, Math.ceil(SAMPLES_PER_LINE / 64), LINES)
    if (this.bEnabled && (c.bGain !== 0 || c.bRing !== 0)) {
      run(this.encodeYuvPl, this.encodeYuvBBg, Math.ceil(ACTIVE_WIDTH / 64), ACTIVE_HEIGHT)
      run(this.mixBPl, this.mixBBg, Math.ceil(SAMPLES_PER_LINE / 64), LINES)
    }
    if (c.cfbMix !== 0) run(this.fbCompositePl, this.fbCompositeBg, Math.ceil(SAMPLES_PER_LINE / 64), LINES)
    run(this.chromaExtractPl, this.chromaExtractBg, Math.ceil(SAMPLES_PER_LINE / 64), LINES)
    run(this.underDownPl, this.underDownBg, Math.ceil(SAMPLES_PER_LINE / 64), LINES)
    run(this.channelPl, this.channelBg, Math.ceil(SAMPLES_PER_LINE / 64), LINES)
    run(this.timebasePl, this.timebaseBg, Math.ceil(SAMPLES_PER_LINE / 64), LINES)
    run(this.syncPl, this.syncBg, 1, 1)
    run(this.lineAnalyzePl, this.lineAnalyzeBg, LINES, 1)
    run(this.decodePl, this.decodeBg, Math.ceil(ACTIVE_WIDTH / 64), ACTIVE_HEIGHT)
    // frame-store capture of what the decoder saw; strobe holds by skipping.
    // Trails force an even period so every capture shares one subcarrier
    // frame parity — a mixed-parity store scrambles hue beyond what
    // burst-lock can correct.
    const period = c.cfbTrail > 0 ? 2 * Math.ceil((c.cfbHold + 1) / 2) : Math.round(c.cfbHold) + 1
    if (this.frame % period === 0) {
      run(this.storePrevPl, this.storePrevBg, Math.ceil(SAMPLES_PER_LINE / 64), LINES)
    }
    pass.end()

    const rp = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpu.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    })
    rp.setPipeline(this.presentPl)
    rp.setBindGroup(0, this.presentBg)
    rp.draw(3)
    rp.end()

    if (this.frame < 3) {
      d.pushErrorScope('validation')
      d.pushErrorScope('internal')
    }
    d.queue.submit([enc.finish()])
    if (this.frame < 3) {
      const f = this.frame
      d.popErrorScope().then((e) => e && console.error(`frame ${f} internal:`, e.message))
      d.popErrorScope().then((e) => e && console.error(`frame ${f} validation:`, e.message))
    }
    if (location.search.includes('debug')) {
      if (this.frame < 3) console.log('DEBUG rendered frame', this.frame)
      if (this.frame === 1) this.debugReadback()
    }
    this.frame += 1
  }

  private async debugReadback(): Promise<void> {
    const d = this.gpu.device
    const read = d.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const enc = d.createCommandEncoder()
    enc.copyBufferToBuffer(this.compA, 0, read, 0, N * 4)
    d.queue.submit([enc.finish()])
    await read.mapAsync(GPUMapMode.READ)
    const a = new Float32Array(read.getMappedRange())
    let min = Infinity
    let max = -Infinity
    for (const v of a) {
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    const midRow = 200
    const line = Array.from(a.slice(midRow * SAMPLES_PER_LINE, midRow * SAMPLES_PER_LINE + 200)).map((v) =>
      Math.round(v),
    )
    console.log('DEBUG compA', JSON.stringify({ min, max, line200first200: line }))
    read.unmap()
    read.destroy()
  }
}
