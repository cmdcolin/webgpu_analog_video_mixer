import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'

// yyyymmdd-hhmmss, so saved files sort chronologically and never collide.
function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function fileName(name: string, ext: string): string {
  const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return `phosphene-${slug}-${stamp()}.${ext}`
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// Prefer VP9, then fall through the codecs a given browser actually ships.
function pickMime(): string {
  const codecs = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  return codecs.find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm'
}

// A WebGPU canvas can't be captured directly: Firefox's toBlob returns a blank
// image and captureStream() emits no frames, because the presented drawing
// buffer isn't retained for async readback. Drawing it into a 2D canvas
// synchronously *does* work, so both paths mirror through one first.
function mirrorOf(src: HTMLCanvasElement): {
  canvas: HTMLCanvasElement
  draw: () => void
} {
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  const g = canvas.getContext('2d')
  return {
    canvas,
    draw: () => g?.drawImage(src, 0, 0, canvas.width, canvas.height),
  }
}

// Save the rendered canvas as a PNG still or a WebM clip. Downstream of
// `present` — the same pixels the user sees — so nothing touches the signal
// path. Recording holds the window visible (rAF at full rate) by design.
export function useCapture(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  name: string,
) {
  const recRef = useRef<{ rec: MediaRecorder; stream: MediaStream } | null>(null)
  const rafRef = useRef(0)
  const [recording, setRecording] = useState(false)

  const grabStill = useCallback(() => {
    const canvas = canvasRef.current
    if (canvas !== null) {
      const mirror = mirrorOf(canvas)
      mirror.draw()
      mirror.canvas.toBlob(blob => {
        if (blob !== null) save(blob, fileName(name, 'png'))
      }, 'image/png')
    }
  }, [canvasRef, name])

  const toggleRecord = useCallback(() => {
    const active = recRef.current
    if (active === null) {
      const canvas = canvasRef.current
      if (canvas !== null) {
        const mirror = mirrorOf(canvas)
        // Pump each rendered frame into the mirror; captureStream() samples it
        // on every change, tracking the engine's frame rate.
        const pump = () => {
          mirror.draw()
          rafRef.current = requestAnimationFrame(pump)
        }
        const stream = mirror.canvas.captureStream()
        const chunks: Blob[] = []
        const rec = new MediaRecorder(stream, { mimeType: pickMime() })
        rec.ondataavailable = e => {
          if (e.data.size > 0) chunks.push(e.data)
        }
        rec.onstop = () => {
          save(new Blob(chunks, { type: rec.mimeType }), fileName(name, 'webm'))
          stream.getTracks().forEach(t => t.stop())
        }
        recRef.current = { rec, stream }
        rafRef.current = requestAnimationFrame(pump)
        rec.start()
        setRecording(true)
      }
    } else {
      cancelAnimationFrame(rafRef.current)
      active.rec.stop()
      recRef.current = null
      setRecording(false)
    }
  }, [canvasRef, name])

  return { recording, toggleRecord, grabStill }
}
