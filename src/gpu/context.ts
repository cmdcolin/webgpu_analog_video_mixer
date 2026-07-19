export interface Gpu {
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
}

export class WebGpuUnavailableError extends Error {}

export async function initGpu(canvas: HTMLCanvasElement): Promise<Gpu> {
  if (!navigator.gpu) {
    throw new WebGpuUnavailableError(
      'This browser has no WebGPU support. Use Chrome/Edge 113+, or Firefox (stable 141+, or Nightly with dom.webgpu.enabled).',
    )
  }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    throw new WebGpuUnavailableError(
      'WebGPU is present but no GPU adapter is available — usually a blocklisted GPU/driver or hardware acceleration disabled. In Firefox try gfx.webgpu.ignore-blocklist; in Chrome enable hardware acceleration.',
    )
  }
  // timestamp-query powers the optional ?prof per-pass timings
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
  })
  device.addEventListener('uncapturederror', (e) => {
    console.error('WebGPU uncaptured:', (e as GPUUncapturedErrorEvent).error.message)
  })
  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('Could not get webgpu canvas context')
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque' })
  return { device, context, format }
}
