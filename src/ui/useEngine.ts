import { useEffect, useRef, useState } from 'react'
import { Engine } from '../gpu/pipeline'
import { DEFAULT_CONTROLS } from '../controls'
import type { ControlKey, Controls, FrameStats } from '../controls'
import { smpteBars, sweep } from '../sources/pattern'
import type { SourceBMode, SourceMode } from '../sources/modes'
import type { Fatal } from './FatalScreen'
import { PRESETS, presetControls } from './presets'

// Load an image source from a URL, for the ?iurl / ?iurlb query params.
const loadImage = (url: string): Promise<ImageBitmap> =>
  fetch(url)
    .then(r => r.blob())
    .then(createImageBitmap)

// Fetch a YouTube clip as a blob through the dev yt-dlp bridge
// (vite-plugin-ytdlp). On failure the endpoint returns the yt-dlp error text.
const fetchYouTube = (url: string): Promise<Blob> =>
  fetch(`/yt?url=${encodeURIComponent(url)}`).then(r =>
    r.ok
      ? r.blob()
      : r.text().then(t => Promise.reject(new Error(t || `${r.status}`))),
  )

// Last path segment of a URL, for labeling ?iurl/?vurl sources by name.
const urlName = (url: string): string => {
  const path = new URL(url, location.href).pathname
  const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
  return name === '' ? url : name
}

// The 11-char video id from a watch/youtu.be URL, for a compact source label.
const ytId = (url: string): string => {
  const u = new URL(url, location.href)
  return u.searchParams.get('v') ?? u.pathname.slice(1)
}

// Vaporwave playback defaults, shared with VaporwaveSection so each slider's
// reset point matches the initial state. VAPORWAVE_SPEED is the one-click look.
export const SPEED_DEFAULT = 1
export const REVERB_DEFAULT = 0.3
export const VAPORWAVE_SPEED = 0.66

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
  const [stats, setStats] = useState<FrameStats>({ fps: 0 })
  const [engine, setEngine] = useState<Engine | null>(null)
  const [sourceMode, setSourceMode] = useState<SourceMode>('bars')
  // Picked/loaded filename, shown while the source is 'file'; '' otherwise.
  const [sourceName, setSourceName] = useState('')
  // Webcam/USB capture: a dialog gates the browser permission prompt, and the
  // device list only carries labels once that grant lands — so both stay empty
  // until the user opts in.
  const [askWebcam, setAskWebcam] = useState(false)
  // Which slot the YouTube URL dialog is loading into, or null when closed.
  const [askYouTube, setAskYouTube] = useState<'a' | 'b' | null>(null)
  // Vaporwave playback: per-slot rate (pitch drops with it), whether the video
  // audio is routed to the speakers + reactive path, and the reverb wet mix.
  // videoA/videoB track whether each slot currently holds a live <video>.
  const [speedA, setSpeedA] = useState(SPEED_DEFAULT)
  const [speedB, setSpeedB] = useState(SPEED_DEFAULT)
  const [playAudio, setPlayAudio] = useState(false)
  const [reverb, setReverb] = useState(REVERB_DEFAULT)
  const [videoA, setVideoA] = useState(false)
  const [videoB, setVideoB] = useState(false)
  // The loaded YouTube URL per slot, kept so the source round-trips through the
  // query string (a refresh or shared link restores the clip).
  const [ytUrlA, setYtUrlA] = useState('')
  const [ytUrlB, setYtUrlB] = useState('')
  // makeVideo stamps the current playback config onto each new element, but it
  // runs inside async fetch callbacks and the mount-time restore, where the
  // state it would close over is stale; this mirror always holds the latest.
  const vaporRef = useRef({
    speedA: SPEED_DEFAULT,
    speedB: SPEED_DEFAULT,
    playAudio: false,
    reverb: REVERB_DEFAULT,
  })
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [webcamDeviceId, setWebcamDeviceId] = useState('')
  const [sourceBMode, setSourceBMode] = useState<SourceBMode>('none')
  const [sourceBName, setSourceBName] = useState('')
  const [renderScale, setRenderScale] = useState(1)
  const renderScaleRef = useRef(1)
  const [res, setRes] = useState('')

  // Backing-store size = css size × min(dpr,2) × render scale, then clamped so
  // the long edge never exceeds MAX_EDGE. The picture is a 754-wide face texture
  // upscaled by the present pass, so past ~2560 the extra output pixels buy no
  // detail — they just pile per-pixel present cost onto the GPU/compositor,
  // which on a big fullscreen display is exactly when the freezes bite.
  const MAX_EDGE = 2560
  const applyCanvasSize = () => {
    const canvas = canvasRef.current
    if (canvas) {
      const dpr = Math.min(window.devicePixelRatio, 2) * renderScaleRef.current
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      const clamp = Math.min(1, MAX_EDGE / Math.max(w, h))
      canvas.width = Math.max(1, Math.round(w * clamp))
      canvas.height = Math.max(1, Math.round(h * clamp))
      setRes(`${canvas.width}×${canvas.height}`)
    }
  }

  const setScale = (v: number) => {
    renderScaleRef.current = v
    setRenderScale(v)
    applyCanvasSize()
  }

  // Adopt the live video slots into the audio graph (or none, muting them all,
  // when off) at the given reverb mix. Explicit args, so callers that also flip
  // a setting pass the new value rather than reading stale state.
  const routeAudio = (on: boolean, mix: number) => {
    const els: HTMLVideoElement[] = []
    for (const v of [videoRef.current, videoBRef.current]) {
      if (v !== null) {
        v.muted = !on
        if (on) els.push(v)
      }
    }
    engineRef.current?.audioState.routeMedia(els, mix)
  }

  const changeSpeedA = (rate: number) => {
    vaporRef.current.speedA = rate
    setSpeedA(rate)
    const v = videoRef.current
    if (v !== null) {
      v.defaultPlaybackRate = rate
      v.playbackRate = rate
    }
  }
  const changeSpeedB = (rate: number) => {
    vaporRef.current.speedB = rate
    setSpeedB(rate)
    const v = videoBRef.current
    if (v !== null) {
      v.defaultPlaybackRate = rate
      v.playbackRate = rate
    }
  }
  const toggleAudio = () => {
    const on = !playAudio
    vaporRef.current.playAudio = on
    setPlayAudio(on)
    routeAudio(on, reverb)
  }
  const changeReverb = (mix: number) => {
    vaporRef.current.reverb = mix
    setReverb(mix)
    engineRef.current?.audioState.setReverbMix(mix)
  }
  // The vaporwave preset: slow both slots, dial in reverb, force audio on.
  const applyVaporwave = () => {
    changeSpeedA(VAPORWAVE_SPEED)
    changeSpeedB(VAPORWAVE_SPEED)
    changeReverb(REVERB_DEFAULT)
    vaporRef.current.playAudio = true
    setPlayAudio(true)
    routeAudio(true, REVERB_DEFAULT)
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
      engineRef.current?.audioState.releaseMedia(v)
    }
    setVideoA(false)
    setYtUrlA('')
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
    const isB = ref === videoBRef
    // preservesPitch off means slowing the rate drops the pitch — the whole
    // point. defaultPlaybackRate too, or loading the src resets playbackRate to
    // 1. muted stays true until routeMedia adopts the element for output.
    const rate = isB ? vaporRef.current.speedB : vaporRef.current.speedA
    v.preservesPitch = false
    v.defaultPlaybackRate = rate
    v.playbackRate = rate
    ref.current = v
    if (isB) setVideoB(true)
    else setVideoA(true)
    // A fresh clip is a new element the audio graph hasn't adopted; re-route so
    // it's captured (and slowed audio keeps playing) when playback audio is on.
    routeAudio(vaporRef.current.playAudio, vaporRef.current.reverb)
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
      } else if (mode === 'youtube') {
        // Same deferral: wait for a URL in the dialog before touching state.
        setAskYouTube('a')
      } else {
        stopVideo()
        setSourceMode(mode)
        setSourceName('')
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
          setSourceName('')
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
      setSourceName(file.name)
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

  // Both A and B feed the clip through the same blob-backed <video> path as a
  // picked file; the only difference is which slot's setters they drive.
  const loadYouTube = (url: string) => {
    const engine = engineRef.current
    const trimmed = url.trim()
    if (engine && trimmed !== '') {
      stopVideo()
      setError('')
      setSourceMode('youtube')
      setYtUrlA(trimmed)
      setSourceName(`youtube: ${ytId(trimmed)} — downloading…`)
      fetchYouTube(trimmed).then(
        blob => {
          const v = makeVideo()
          v.src = URL.createObjectURL(blob)
          v.play()
            .then(() => engine.setVideoSource(v))
            .catch(() => {})
          setSourceName(`youtube: ${ytId(trimmed)}`)
        },
        (e: unknown) => {
          setError(`youtube: ${e instanceof Error ? e.message : String(e)}`)
          setSourceName('')
        },
      )
    }
  }

  const loadYouTubeB = (url: string) => {
    const engine = engineRef.current
    const trimmed = url.trim()
    if (engine && trimmed !== '') {
      stopVideoB()
      setError('')
      setSourceBMode('youtube')
      setYtUrlB(trimmed)
      setSourceBName(`youtube: ${ytId(trimmed)} — downloading…`)
      engine.setSourceBEnabled(true)
      fetchYouTube(trimmed).then(
        blob => {
          const v = makeVideo(videoBRef)
          v.src = URL.createObjectURL(blob)
          v.play()
            .then(() => engine.setVideoSourceB(v))
            .catch(() => {})
          setSourceBName(`youtube: ${ytId(trimmed)}`)
        },
        (e: unknown) => {
          setError(`youtube: ${e instanceof Error ? e.message : String(e)}`)
          setSourceBName('')
          setSourceBMode('none')
          engine.setSourceBEnabled(false)
        },
      )
    }
  }

  const stopVideoB = () => {
    const v = videoBRef.current
    if (v) {
      v.pause()
      if (v.src.startsWith('blob:')) URL.revokeObjectURL(v.src)
      v.removeAttribute('src')
      videoBRef.current = null
      engineRef.current?.audioState.releaseMedia(v)
    }
    setVideoB(false)
    setYtUrlB('')
    engineRef.current?.setVideoSourceB(null)
  }

  const selectSourceB = (mode: SourceBMode) => {
    const engine = engineRef.current
    if (engine) {
      setError('') // entry for every B change (incl. file dialog); clear once
      if (mode === 'file') {
        fileInputBRef.current?.click()
      } else if (mode === 'youtube') {
        setAskYouTube('b')
      } else {
        stopVideoB()
        setSourceBMode(mode)
        setSourceBName('')
        engine.setSourceBEnabled(mode !== 'none')
        if (mode === 'bars') engine.setImageSourceB(smpteBars())
        else if (mode === 'sweep') engine.setImageSourceB(sweep())
        else if (mode === 'tv static') engine.setNoiseSourceB(1)
        else if (mode === 'vhs static') engine.setNoiseSourceB(2)
      }
    }
  }

  const onFileB = (file: File | undefined) => {
    const engine = engineRef.current
    if (file && engine) {
      stopVideoB()
      setSourceBMode('file')
      setSourceBName(file.name)
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
      // A full page reload doesn't run this effect's cleanup, so the GPUDevice
      // is abandoned rather than destroyed — and a wedged GPU then carries into
      // the reloaded page's fresh device (why "just refresh" often fails to
      // recover). Release it on pagehide so the reload starts GPU-clean.
      const onPageHide = () => engineRef.current?.destroy()
      window.addEventListener('pagehide', onPageHide)
      let disposed = false
      Engine.create(canvas).then(
        engine => {
          if (disposed) {
            engine.destroy()
          } else {
            engineRef.current = engine
            setEngine(engine)
            window.vf = engine
            engine.onStats = setStats
            engine.onDeviceLost = m =>
              setFatal({
                title: 'WebGPU device lost',
                body: m === '' ? 'The GPU device was lost.' : m,
                kind: 'lost',
              })
            engine.setImageSource(smpteBars())
            engine.setSourceBEnabled(false) // B is off by default; opt in via the B dropdown
            const q = new URLSearchParams(location.search)
            const presetName = q.get('preset')
            if (presetName !== null) {
              const p = PRESETS.find(x => x.name === presetName)
              if (p) engine.applyControls(presetControls(p.patch))
            }
            const setParam = q.get('set')
            if (setParam !== null) {
              const patch: Partial<Controls> = {}
              for (const pair of setParam.split(',')) {
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
            const onImageError = (e: unknown) =>
              setError(`image: ${e instanceof Error ? e.message : String(e)}`)
            const iurl = q.get('iurl')
            if (iurl !== null) {
              loadImage(iurl).then(bmp => {
                engine.setImageSource(bmp, bmp.width / bmp.height)
                setSourceMode('file')
                setSourceName(urlName(iurl))
              }, onImageError)
            }
            const iurlb = q.get('iurlb')
            if (iurlb !== null) {
              loadImage(iurlb).then(bmp => {
                engine.setImageSourceB(bmp)
                engine.setSourceBEnabled(true)
                setSourceBMode('file')
                setSourceBName(urlName(iurlb))
              }, onImageError)
            }
            const vurl = q.get('vurl')
            if (vurl !== null) {
              const v = makeVideo()
              v.src = vurl
              v.play()
                .then(() => engine.setVideoSource(v))
                .catch(() => {})
              setSourceMode('file')
              setSourceName(urlName(vurl))
            }
            // Vaporwave + YouTube round-trip: apply the speeds/reverb before
            // loading, so the restored clips (makeVideo reads vaporRef) start
            // already slowed. Audio is left off — browsers block unmuted
            // autoplay without a gesture, so the clip must load muted; the user
            // re-enables sound with one click on the panel toggle.
            const num = (key: string, fallback: number) => {
              const raw = q.get(key)
              const n = raw === null ? fallback : Number(raw)
              return Number.isFinite(n) ? n : fallback
            }
            vaporRef.current = {
              speedA: num('speeda', SPEED_DEFAULT),
              speedB: num('speedb', SPEED_DEFAULT),
              reverb: num('reverb', REVERB_DEFAULT),
              playAudio: false,
            }
            setSpeedA(vaporRef.current.speedA)
            setSpeedB(vaporRef.current.speedB)
            setReverb(vaporRef.current.reverb)
            const yt = q.get('yt')
            if (yt !== null) loadYouTube(yt)
            const ytb = q.get('ytb')
            if (ytb !== null) loadYouTubeB(ytb)
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
        window.removeEventListener('pagehide', onPageHide)
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
    stats,
    res,
    renderScale,
    setScale,
    sourceMode,
    sourceName,
    selectSource,
    sourceBMode,
    sourceBName,
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
    loadYouTube,
    loadYouTubeB,
    askYouTube,
    setAskYouTube,
    videoA,
    videoB,
    speedA,
    speedB,
    playAudio,
    reverb,
    ytUrlA,
    ytUrlB,
    changeSpeedA,
    changeSpeedB,
    toggleAudio,
    changeReverb,
    applyVaporwave,
  }
}
