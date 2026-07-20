import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CONTROLS, Engine } from '../gpu/pipeline'
import type { ControlKey, Controls } from '../gpu/pipeline'
import { smpteBars, sweep } from '../sources/pattern'
import type { SourceBMode, SourceMode } from '../sources/modes'
import type { Fatal } from './FatalScreen'

declare global {
  interface Window {
    vf?: Engine
  }
}

// Owns the singleton Engine (a GPUDevice + rAF loop), its lifecycle, and every
// video/image source path (patterns, files, webcam/USB capture, source B).
export function useEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoBRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputBRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [fatal, setFatal] = useState<Fatal | null>(null)
  const [fps, setFps] = useState(0)
  const [engine, setEngine] = useState<Engine | null>(null)
  const [sourceMode, setSourceMode] = useState<SourceMode>('bars')
  // Webcam/USB capture: a dialog gates the browser permission prompt, and the
  // device list only carries labels once that grant lands — so both stay empty
  // until the user opts in.
  const [askWebcam, setAskWebcam] = useState(false)
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [webcamDeviceId, setWebcamDeviceId] = useState('')
  const [sourceBMode, setSourceBMode] = useState<SourceBMode>('none')
  const [renderScale, setRenderScale] = useState(1)
  const renderScaleRef = useRef(1)
  const [res, setRes] = useState('')

  // Backing-store size = css size × min(dpr,2) × render scale. Lowering the
  // scale is a cheap speed lever (the present pass runs per output pixel).
  const applyCanvasSize = () => {
    const canvas = canvasRef.current
    if (canvas) {
      const dpr = Math.min(window.devicePixelRatio, 2) * renderScaleRef.current
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr))
      setRes(`${canvas.width}×${canvas.height}`)
    }
  }

  const setScale = (v: number) => {
    renderScaleRef.current = v
    setRenderScale(v)
    applyCanvasSize()
  }

  const stopVideo = () => {
    const v = videoRef.current
    if (v) {
      v.pause()
      if (v.srcObject instanceof MediaStream)
        v.srcObject.getTracks().forEach(t => t.stop())
      v.srcObject = null
      if (v.src.startsWith('blob:')) URL.revokeObjectURL(v.src)
      v.removeAttribute('src')
      videoRef.current = null
    }
    engineRef.current?.setVideoSource(null)
  }

  const makeVideo = (
    ref: React.RefObject<HTMLVideoElement | null> = videoRef,
  ): HTMLVideoElement => {
    const v = document.createElement('video')
    v.muted = true
    v.loop = true
    v.playsInline = true
    v.addEventListener('error', () => {
      setError(
        `video error: ${v.error?.message ?? 'unknown'} (code ${v.error?.code ?? '?'})`,
      )
      console.log('DEBUG video error', v.error?.code, v.error?.message)
    })
    v.addEventListener('playing', () =>
      console.log('DEBUG video playing', v.videoWidth, v.videoHeight),
    )
    ref.current = v
    return v
  }

  const selectSource = (mode: SourceMode) => {
    const engine = engineRef.current
    if (engine) {
      // Every source change starts here (file picks too — the file dialog is
      // only opened from this handler), so clear any stale failure banner once.
      setError('')
      // For file, wait until a file is actually picked before touching state:
      // cancelling the OS dialog then leaves the current source untouched.
      if (mode === 'file') {
        fileInputRef.current?.click()
      } else if (mode === 'webcam') {
        // Defer stopVideo/setSourceMode until the user confirms in the dialog:
        // cancelling then leaves the current source (and its permission) alone.
        setAskWebcam(true)
      } else {
        stopVideo()
        setSourceMode(mode)
        if (mode === 'bars') engine.setImageSource(smpteBars())
        else if (mode === 'sweep') engine.setImageSource(sweep())
        else if (mode === 'tv static') engine.setNoiseSource(1)
        else engine.setNoiseSource(2)
      }
    }
  }

  // Actually opens the device once the user confirms; deviceId '' takes the
  // OS default, otherwise pins the chosen capture device (e.g. an RCA grabber).
  // No resolution constraint — composite dongles deliver 720x480, so we take
  // whatever the device negotiates rather than forcing 1280x720.
  const startWebcam = (deviceId: string) => {
    const engine = engineRef.current
    if (engine) {
      stopVideo()
      const video = deviceId === '' ? true : { deviceId: { exact: deviceId } }
      navigator.mediaDevices.getUserMedia({ video }).then(
        stream => {
          const v = makeVideo()
          v.srcObject = stream
          v.play()
            .then(() => engine.setVideoSource(v))
            .catch(() => {})
          setSourceMode('webcam')
          setAskWebcam(false)
          // Capture cards weave interlaced fields, so combing shows on motion;
          // bob-deinterlace on by default for this source (toggle in Signal A).
          engine.setControl('deint', 1)
          const active = stream.getVideoTracks()[0]?.getSettings().deviceId
          setWebcamDeviceId(active ?? '')
          // Labels populate only after this grant, so enumerate now.
          navigator.mediaDevices
            .enumerateDevices()
            .then(devices =>
              setVideoDevices(devices.filter(d => d.kind === 'videoinput')),
            )
            .catch(() => {})
        },
        (e: unknown) =>
          setError(`capture: ${e instanceof Error ? e.message : String(e)}`),
      )
    }
  }

  const onFile = (file: File | undefined) => {
    const engine = engineRef.current
    if (file && engine) {
      stopVideo()
      setSourceMode('file')
      if (file.type.startsWith('image/')) {
        createImageBitmap(file).then(
          bmp => engine.setImageSource(bmp, bmp.width / bmp.height),
          (e: unknown) =>
            setError(`image: ${e instanceof Error ? e.message : String(e)}`),
        )
      } else {
        const v = makeVideo()
        v.src = URL.createObjectURL(file)
        v.play()
          .then(() => engine.setVideoSource(v))
          .catch(() => {})
      }
    }
  }

  const stopVideoB = () => {
    const v = videoBRef.current
    if (v) {
      v.pause()
      if (v.src.startsWith('blob:')) URL.revokeObjectURL(v.src)
      v.removeAttribute('src')
      videoBRef.current = null
    }
    engineRef.current?.setVideoSourceB(null)
  }

  const selectSourceB = (mode: SourceBMode) => {
    const engine = engineRef.current
    if (engine) {
      setError('') // entry for every B change (incl. file dialog); clear once
      if (mode === 'file') {
        fileInputBRef.current?.click()
      } else {
        stopVideoB()
        setSourceBMode(mode)
        engine.setSourceBEnabled(mode !== 'none')
        if (mode === 'bars') engine.setImageSourceB(smpteBars())
        else if (mode === 'sweep') engine.setImageSourceB(sweep())
      }
    }
  }

  const onFileB = (file: File | undefined) => {
    const engine = engineRef.current
    if (file && engine) {
      stopVideoB()
      setSourceBMode('file')
      engine.setSourceBEnabled(true)
      if (file.type.startsWith('image/')) {
        createImageBitmap(file).then(
          bmp => engine.setImageSourceB(bmp),
          (e: unknown) =>
            setError(`image: ${e instanceof Error ? e.message : String(e)}`),
        )
      } else {
        const v = makeVideo(videoBRef)
        v.src = URL.createObjectURL(file)
        v.play()
          .then(() => engine.setVideoSourceB(v))
          .catch(() => {})
      }
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      applyCanvasSize()
      // Keep the drawing buffer matched to the element as the panel hides or
      // the window enters fullscreen, so the picture never stretches.
      const ro = new ResizeObserver(applyCanvasSize)
      ro.observe(canvas)
      let disposed = false
      Engine.create(canvas).then(
        engine => {
          if (disposed) {
            engine.destroy()
          } else {
            engineRef.current = engine
            setEngine(engine)
            window.vf = engine
            engine.onStats = setFps
            engine.onDeviceLost = m =>
              setFatal({
                title: 'WebGPU device lost',
                body: m === '' ? 'The GPU device was lost.' : m,
                kind: 'lost',
              })
            engine.setImageSource(smpteBars())
            engine.setSourceBEnabled(false) // B is off by default; opt in via the B dropdown
            const q = new URLSearchParams(location.search)
            const preset = q.get('set')
            if (preset !== null) {
              const patch: Partial<Controls> = {}
              for (const pair of preset.split(',')) {
                const [k, v] = pair.split(':')
                const n = Number(v)
                if (k in DEFAULT_CONTROLS && Number.isFinite(n))
                  patch[k as ControlKey] = n
              }
              engine.applyControls(patch)
            }
            if (q.get('src') === 'sweep') {
              engine.setImageSource(sweep())
              setSourceMode('sweep')
            }
            if (q.get('src') === 'tv static') {
              engine.setNoiseSource(1)
              setSourceMode('tv static')
            }
            if (q.get('src') === 'vhs static') {
              engine.setNoiseSource(2)
              setSourceMode('vhs static')
            }
            if (q.get('src') === 'webcam') selectSource('webcam')
            // Source B (off by default, so only an enabled mode is serialized)
            const srcb = q.get('srcb')
            if (srcb === 'bars') {
              engine.setImageSourceB(smpteBars())
              engine.setSourceBEnabled(true)
              setSourceBMode('bars')
            } else if (srcb === 'sweep') {
              engine.setImageSourceB(sweep())
              engine.setSourceBEnabled(true)
              setSourceBMode('sweep')
            }
            const vurl = q.get('vurl')
            if (vurl !== null) {
              const v = makeVideo()
              v.src = vurl
              v.play()
                .then(() => engine.setVideoSource(v))
                .catch(() => {})
              setSourceMode('file')
            }
            if (q.has('debug')) console.log('DEBUG engine ready')
          }
        },
        (e: unknown) =>
          setFatal({
            title: 'WebGPU unavailable',
            body: e instanceof Error ? e.message : String(e),
            kind: 'unavailable',
          }),
      )
      return () => {
        disposed = true
        ro.disconnect()
        stopVideo()
        stopVideoB()
        engineRef.current?.destroy()
        engineRef.current = null
      }
    }
    // Mount-once: creates the single engine and reads URL params. selectSource
    // is stable enough for the one-shot ?src=webcam path; re-running on its
    // identity would tear down and rebuild the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    canvasRef,
    engineRef,
    engine,
    fatal,
    error,
    fps,
    res,
    renderScale,
    setScale,
    sourceMode,
    selectSource,
    sourceBMode,
    selectSourceB,
    askWebcam,
    setAskWebcam,
    videoDevices,
    webcamDeviceId,
    startWebcam,
    fileInputRef,
    fileInputBRef,
    onFile,
    onFileB,
  }
}
