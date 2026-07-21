import type { FrameStats } from '../controls'

// Frames per stats window. Shorter windows update the readout more responsively;
// ~15 frames is roughly a quarter-second at 60 fps.
const STATS_WINDOW = 15

// Liveness watchdog, fired from a setInterval (which keeps running even when
// requestAnimationFrame does not). It handles two independent failures:
//
//  - rAF stops being delivered while the tab is visible and focused. Firefox on
//    Linux does this across fullscreen transitions and window occlusion even
//    though visibilityState stays 'visible', and re-requesting rAF does not wake
//    it. So instead of relying on rAF, we drive the render loop from setTimeout
//    (FALLBACK_MS) until rAF resumes — the picture stays live either way.
//  - The GPU itself wedges: submitted work never completes (Firefox/Linux can
//    silently lose the device without firing device.lost). We probe queue
//    completion raced against HANG_MS; HANG_STRIKES consecutive misses means the
//    loop is spinning on a dead device, so we surface it instead of freezing.
const WATCHDOG_MS = 2000
const FALLBACK_MS = 33
const HANG_MS = 4000
const HANG_STRIKES = 2

export interface RenderLoopHost {
  device: GPUDevice
  render: () => void
  onStats: (stats: FrameStats) => void
  onDeviceLost: (message: string) => void
  // Current frame number, for log breadcrumbs only.
  frameNo: () => number
}

// Drives one render callback at display rate and keeps it alive across the
// Firefox/Linux failure modes that freeze a naive rAF loop: rAF silently
// ceasing to fire while the tab is visible, and the GPU device wedging without
// firing device.lost. Pure lifecycle machinery — it knows nothing about the
// signal path it happens to be pumping.
export class RenderLoop {
  private host: RenderLoopHost
  private live = false
  private lastTime = 0
  private frameAcc = 0
  private frameCount = 0
  private rafId = 0
  private renderErrors = 0
  private watchdogId = 0
  private hangStrikes = 0
  private probing = false
  private rafTicks = 0
  private lastRafTicks = 0
  private stalled = false
  private fallbackId = 0

  constructor(host: RenderLoopHost) {
    this.host = host
  }

  get running(): boolean {
    return this.live
  }

  start(): void {
    this.live = true
    this.rafId = requestAnimationFrame(this.tick)
    this.watchdogId = window.setInterval(this.watchdog, WATCHDOG_MS)
  }

  stop(): void {
    this.live = false
    cancelAnimationFrame(this.rafId)
    clearInterval(this.watchdogId)
    clearTimeout(this.fallbackId)
  }

  private tick = (time: number): void => {
    if (!this.live) return
    // Re-arm the next frame FIRST, before any work. A synchronous throw below
    // (e.g. getCurrentTexture during a fullscreen/visibility transition, or a
    // React setState in onStats) then can't leave the loop un-scheduled — the
    // classic "canvas froze, controls look dead" hang after exiting fullscreen.
    this.rafId = requestAnimationFrame(this.tick)
    this.rafTicks += 1 // proof rAF is actually being delivered (watchdog reads it)
    this.runFrame(time)
  }

  // One frame: stats + render, shared by the rAF loop and the setTimeout
  // fallback. Never throws — a bad frame must not stop whichever driver called.
  private runFrame(time: number): void {
    if (this.lastTime > 0) {
      const dt = time - this.lastTime
      this.frameAcc += dt
      this.frameCount += 1
      if (this.frameCount === STATS_WINDOW) {
        this.host.onStats({ fps: 1000 / (this.frameAcc / STATS_WINDOW) })
        this.frameAcc = 0
        this.frameCount = 0
      }
    }
    this.lastTime = time
    try {
      this.host.render()
    } catch (e) {
      this.renderErrors += 1
      if (this.renderErrors <= 3 || this.renderErrors % 120 === 0) {
        console.error(`render error #${this.renderErrors} (loop continues):`, e)
      }
    }
  }

  // setTimeout-driven fallback for when rAF has stopped being delivered. Runs
  // only while the watchdog has flagged a stall; hands straight back to rAF the
  // moment it resumes (the watchdog clears `stalled`).
  private pump = (): void => {
    this.fallbackId = 0
    if (this.live && this.stalled && document.visibilityState === 'visible') {
      this.runFrame(performance.now())
      this.fallbackId = window.setTimeout(this.pump, FALLBACK_MS)
    }
  }

  // Re-arm the loop after a transition (fullscreen exit, tab re-shown) that can
  // leave the browser having stopped delivering rAF callbacks. Idempotent: it
  // cancels any pending frame first, so calling it when the loop is healthy is a
  // no-op rather than a double-schedule.
  kick(): void {
    if (this.live) {
      cancelAnimationFrame(this.rafId)
      this.rafId = requestAnimationFrame(this.tick)
    }
  }

  // Detect a silently-dead device: while visible, re-arming rAF gets the loop
  // ticking again, but if the GPU itself is wedged the submitted work never
  // completes and the canvas stays frozen with no error. Probe queue completion
  // raced against a timeout; enough consecutive misses means the loop is
  // spinning on a dead device — surface it so the user gets guidance instead of
  // a frozen picture that a reload won't fix.
  private watchdog = (): void => {
    if (!this.live || document.visibilityState !== 'visible') return
    // The watchdog firing at all proves the main thread is alive. rAF throttling
    // while the window is unfocused/occluded is expected, so only judge rAF
    // liveness when focused: if rafTicks hasn't advanced since the last check,
    // the browser has stopped delivering rAF even though we're visible+focused
    // (Firefox/Linux does this across fullscreen transitions, and re-requesting
    // doesn't wake it). Drive the loop from setTimeout until rAF resumes.
    if (document.hasFocus()) {
      const rafAlive = this.rafTicks !== this.lastRafTicks
      this.lastRafTicks = this.rafTicks
      if (!rafAlive && !this.stalled) {
        this.stalled = true
        console.warn(
          `rAF not delivering (frame ${this.host.frameNo()}); driving via setTimeout fallback`,
        )
        if (this.fallbackId === 0) this.pump()
      } else if (rafAlive && this.stalled) {
        this.stalled = false
        console.warn(`rAF resumed at frame ${this.host.frameNo()}; leaving fallback`)
      }
      if (!rafAlive) this.kick() // still give rAF a chance to wake on its own
    } else {
      this.lastRafTicks = this.rafTicks // keep baseline fresh so refocus isn't a false stall
      this.stalled = false // unfocused throttling is expected; let the fallback stop
    }
    if (this.probing) return
    this.probing = true
    let settled = false
    const strike = () => {
      if (!settled) {
        settled = true
        this.probing = false
        this.hangStrikes += 1
        console.error(
          `GPU work has not completed for ~${this.hangStrikes * HANG_MS}ms (strike ${this.hangStrikes}/${HANG_STRIKES})`,
        )
        if (this.hangStrikes >= HANG_STRIKES && this.live) {
          this.live = false
          this.host.onDeviceLost(
            'The GPU stopped responding. Close this browser tab and open the app again — a reload may not recover a hung GPU.',
          )
        }
      }
    }
    const timer = setTimeout(strike, HANG_MS)
    try {
      void this.host.device.queue.onSubmittedWorkDone().then(() => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          this.probing = false
          this.hangStrikes = 0
        }
      }, strike)
    } catch {
      clearTimeout(timer)
      strike()
    }
  }
}
