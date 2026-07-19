// Per-pass GPU timing via timestamp-query, enabled with ?prof when the
// adapter supports it. Each compute pass gets begin/end timestamps; an
// exponential moving average per pass label (dub generations merge) is
// printed every 120 sampled frames, slowest first.

const CAPACITY = 32
// Sample sparsely: a per-frame mapAsync readback stalls the pipeline hard
// enough to distort the very numbers being measured (and the frame rate).
const SAMPLE_EVERY = 8

export class GpuProfiler {
  private readonly querySet: GPUQuerySet
  private readonly resolveBuf: GPUBuffer
  private readonly readBuf: GPUBuffer
  private labels: string[] = []
  private readonly ema = new Map<string, number>()
  private frames = 0
  private samples = 0
  private pending = false
  private sampling = false

  static create(device: GPUDevice): GpuProfiler | null {
    return device.features.has('timestamp-query') ? new GpuProfiler(device) : null
  }

  private constructor(device: GPUDevice) {
    this.querySet = device.createQuerySet({ type: 'timestamp', count: 2 * CAPACITY })
    this.resolveBuf = device.createBuffer({
      size: 16 * CAPACITY,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    })
    this.readBuf = device.createBuffer({
      size: 16 * CAPACITY,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
  }

  begin(): void {
    this.labels = []
    this.sampling = !this.pending && this.frames % SAMPLE_EVERY === 0
    this.frames += 1
  }

  // Off-sample frames and frames with a readback still in flight go unsampled
  // (labels stay empty), so resolve/report become no-ops.
  passDescriptor(label: string): GPUComputePassDescriptor | undefined {
    const i = this.labels.length
    const active = this.sampling && i < CAPACITY
    if (active) {
      this.labels.push(label)
    }
    return active
      ? {
          timestampWrites: {
            querySet: this.querySet,
            beginningOfPassWriteIndex: 2 * i,
            endOfPassWriteIndex: 2 * i + 1,
          },
        }
      : undefined
  }

  resolve(enc: GPUCommandEncoder): void {
    if (this.labels.length > 0) {
      enc.resolveQuerySet(this.querySet, 0, 2 * this.labels.length, this.resolveBuf, 0)
      enc.copyBufferToBuffer(this.resolveBuf, 0, this.readBuf, 0, 16 * this.labels.length)
    }
  }

  // Call after queue.submit of the encoder given to resolve().
  report(): void {
    if (this.labels.length > 0) {
      const labels = this.labels
      this.pending = true
      this.readBuf.mapAsync(GPUMapMode.READ).then(
        () => {
          const t = new BigUint64Array(this.readBuf.getMappedRange(0, 16 * labels.length))
          // sum repeated labels (per-generation passes) so each row and the
          // total are true per-frame costs
          const frameMs = new Map<string, number>()
          labels.forEach((label, i) => {
            const ms = Number(t[2 * i + 1] - t[2 * i]) / 1e6
            frameMs.set(label, (frameMs.get(label) ?? 0) + ms)
          })
          for (const [label, ms] of frameMs) {
            const prev = this.ema.get(label)
            this.ema.set(label, prev === undefined ? ms : prev + 0.05 * (ms - prev))
          }
          this.readBuf.unmap()
          this.pending = false
          this.samples += 1
          if (this.samples % 30 === 0) {
            const rows = [...this.ema.entries()].sort((a, b) => b[1] - a[1])
            const total = rows.reduce((sum, [, v]) => sum + v, 0)
            console.log(
              `GPU compute ${total.toFixed(2)} ms/frame\n${rows.map(([l, v]) => `  ${l.padEnd(16)} ${v.toFixed(3)}`).join('\n')}`,
            )
          }
        },
        () => {
          this.pending = false
        },
      )
    }
  }
}
