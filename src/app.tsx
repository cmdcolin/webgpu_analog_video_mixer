import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CONTROLS, Engine } from './gpu/pipeline'
import type { ControlKey, Controls } from './gpu/pipeline'
import { smpteBars, sweep } from './sources/pattern'
import { GROUPS } from './ui/controls'
import { BUILTIN_PRESETS, loadSlots, presetControls, saveSlot } from './ui/presets'

const panelStyle: React.CSSProperties = {
  width: 300,
  overflowY: 'auto',
  padding: '10px 14px',
  background: '#16161a',
  color: '#c8c8d0',
  fontFamily: 'monospace',
  fontSize: 11,
  flexShrink: 0,
}

const btnStyle: React.CSSProperties = {
  background: '#26262e',
  color: '#c8c8d0',
  border: '1px solid #3a3a44',
  borderRadius: 3,
  padding: '3px 8px',
  margin: '2px 3px 2px 0',
  fontFamily: 'monospace',
  fontSize: 11,
  cursor: 'pointer',
}

const fsBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  background: 'rgba(22,22,26,0.6)',
  color: '#c8c8d0',
  border: '1px solid #3a3a44',
  borderRadius: 3,
  padding: '4px 9px',
  fontFamily: 'monospace',
  fontSize: 11,
  cursor: 'pointer',
}

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 11,
  margin: '12px 0 2px',
  color: '#8888a0',
  textTransform: 'uppercase',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  userSelect: 'none',
}

function Section(props: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <h3 style={sectionHeadStyle} onClick={() => setOpen((o) => !o)}>
        <span>{props.title}</span>
        <span style={{ color: '#5a5a66' }}>{open ? '▾' : '▸'}</span>
      </h3>
      {open ? props.children : null}
    </div>
  )
}

const fatalWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100vw',
  height: '100vh',
  background: '#0a0a0c',
  padding: 20,
  boxSizing: 'border-box',
}

const fatalCardStyle: React.CSSProperties = {
  maxWidth: 560,
  background: '#16161a',
  border: '1px solid #3a3a44',
  borderRadius: 8,
  padding: '24px 28px',
  color: '#c8c8d0',
  fontFamily: 'monospace',
  fontSize: 13,
  lineHeight: 1.6,
}

function Slider(props: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  defaultValue: number
  onChange: (v: number) => void
}) {
  return (
    <label style={{ display: 'block', margin: '6px 0' }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>{props.label}</span>
        <span style={{ color: '#7fd0a0' }}>
          {props.value.toFixed(props.step < 0.01 ? 3 : props.step < 1 ? 2 : 0)}
          {props.unit}
          <button
            title="reset"
            style={{
              background: 'none',
              border: 'none',
              color: props.value === props.defaultValue ? '#3a3a44' : '#8888a0',
              cursor: 'pointer',
              fontSize: 11,
              padding: '0 0 0 5px',
            }}
            onClick={(e) => {
              e.preventDefault()
              props.onChange(props.defaultValue)
            }}
          >
            ↺
          </button>
        </span>
      </span>
      <input
        type="range"
        style={{ width: '100%' }}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

type SourceMode = 'bars' | 'sweep' | 'file' | 'webcam'
type SourceBMode = 'none' | 'bars' | 'sweep' | 'file'
type Fatal = { title: string; body: string; kind: 'unavailable' | 'lost' }

declare global {
  interface Window {
    vf?: Engine
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoBRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputBRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [fatal, setFatal] = useState<Fatal | null>(null)
  const [fps, setFps] = useState(0)
  const [values, setValues] = useState({ ...DEFAULT_CONTROLS })
  const [sourceMode, setSourceMode] = useState<SourceMode>('bars')
  const [sourceBMode, setSourceBMode] = useState<SourceBMode>('bars')
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
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

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }

  const applyControls = (controls: Controls) => {
    setValues(controls)
    engineRef.current?.applyControls(controls)
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
        (engine) => {
          if (disposed) {
            engine.destroy()
          } else {
            engineRef.current = engine
            window.vf = engine
            engine.onStats = setFps
            engine.onDeviceLost = (m) =>
              setFatal({ title: 'WebGPU device lost', body: m === '' ? 'The GPU device was lost.' : m, kind: 'lost' })
            engine.setImageSource(smpteBars())
            engine.setImageSourceB(smpteBars())
            const preset = new URLSearchParams(location.search).get('set')
            if (preset !== null) {
              const patch: Partial<Controls> = {}
              for (const pair of preset.split(',')) {
                const [k, v] = pair.split(':')
                if (k in DEFAULT_CONTROLS) patch[k as ControlKey] = Number(v)
              }
              setValues((prev) => ({ ...prev, ...patch }))
              engine.applyControls(patch)
            }
            const q = new URLSearchParams(location.search)
            if (q.get('src') === 'sweep') engine.setImageSource(sweep())
            if (q.get('src') === 'webcam') selectSource('webcam')
            const vurl = q.get('vurl')
            if (vurl !== null) {
              const v = makeVideo()
              v.src = vurl
              v.play().then(() => engine.setVideoSource(v))
            }
            if (q.has('debug')) console.log('DEBUG engine ready')
          }
        },
        (e: unknown) =>
          setFatal({ title: 'WebGPU unavailable', body: e instanceof Error ? e.message : String(e), kind: 'unavailable' }),
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
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const engine = engineRef.current
      const typing = e.target instanceof HTMLInputElement
      if (!typing && e.key === 'f') {
        toggleFullscreen()
      } else if (!typing && engine && e.key >= '1' && e.key <= '8') {
        const slot = Number(e.key)
        if (e.shiftKey) {
          saveSlot(slot, engine.controls)
        } else {
          const stored = loadSlots()[String(slot)]
          if (stored) applyControls({ ...DEFAULT_CONTROLS, ...stored })
        }
      }
    }
    const onFs = () => setFullscreen(document.fullscreenElement !== null)
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [])

  const setControl = (key: ControlKey, v: number) => {
    setValues((prev) => ({ ...prev, [key]: v }))
    engineRef.current?.setControl(key, v)
  }

  const setScale = (v: number) => {
    renderScaleRef.current = v
    setRenderScale(v)
    applyCanvasSize()
  }

  // Serialize non-default controls into the ?set= URL the loader already reads.
  const copyLink = () => {
    const set = (Object.keys(DEFAULT_CONTROLS) as ControlKey[])
      .filter((k) => values[k] !== DEFAULT_CONTROLS[k])
      .map((k) => `${k}:${+values[k].toFixed(4)}`)
    const q = [...(set.length ? [`set=${set.join(',')}`] : [])]
    if (sourceMode === 'sweep' || sourceMode === 'webcam') q.push(`src=${sourceMode}`)
    const url = `${location.origin}${location.pathname}${q.length ? `?${q.join('&')}` : ''}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  const stopVideo = () => {
    const v = videoRef.current
    if (v) {
      v.pause()
      if (v.srcObject instanceof MediaStream) v.srcObject.getTracks().forEach((t) => t.stop())
      v.srcObject = null
      if (v.src.startsWith('blob:')) URL.revokeObjectURL(v.src)
      v.removeAttribute('src')
      videoRef.current = null
    }
    engineRef.current?.setVideoSource(null)
  }

  const makeVideo = (ref: React.RefObject<HTMLVideoElement | null> = videoRef): HTMLVideoElement => {
    const v = document.createElement('video')
    v.muted = true
    v.loop = true
    v.playsInline = true
    v.addEventListener('error', () => {
      setError(`video error: ${v.error?.message ?? 'unknown'} (code ${v.error?.code ?? '?'})`)
      console.log('DEBUG video error', v.error?.code, v.error?.message)
    })
    v.addEventListener('playing', () => console.log('DEBUG video playing', v.videoWidth, v.videoHeight))
    ref.current = v
    return v
  }

  const selectSource = (mode: SourceMode) => {
    setSourceMode(mode)
    stopVideo()
    const engine = engineRef.current
    if (engine) {
      if (mode === 'bars') engine.setImageSource(smpteBars())
      else if (mode === 'sweep') engine.setImageSource(sweep())
      else if (mode === 'file') fileInputRef.current?.click()
      else {
        navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } }).then(
          (stream) => {
            const v = makeVideo()
            v.srcObject = stream
            v.play().then(() => engine.setVideoSource(v))
          },
          (e: unknown) => setError(`webcam: ${e instanceof Error ? e.message : String(e)}`),
        )
      }
    }
  }

  const onFile = (file: File | undefined) => {
    const engine = engineRef.current
    if (file && engine) {
      if (file.type.startsWith('image/')) {
        createImageBitmap(file).then(
          (bmp) => engine.setImageSource(bmp, bmp.width / bmp.height),
          (e: unknown) => setError(`image: ${e instanceof Error ? e.message : String(e)}`),
        )
      } else {
        const v = makeVideo()
        v.src = URL.createObjectURL(file)
        v.play().then(() => engine.setVideoSource(v))
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
    setSourceBMode(mode)
    stopVideoB()
    const engine = engineRef.current
    if (engine) {
      engine.setSourceBEnabled(mode !== 'none')
      if (mode === 'bars') engine.setImageSourceB(smpteBars())
      else if (mode === 'sweep') engine.setImageSourceB(sweep())
      else if (mode === 'file') fileInputBRef.current?.click()
    }
  }

  const onFileB = (file: File | undefined) => {
    const engine = engineRef.current
    if (file && engine) {
      if (file.type.startsWith('image/')) {
        createImageBitmap(file).then(
          (bmp) => engine.setImageSourceB(bmp),
          (e: unknown) => setError(`image: ${e instanceof Error ? e.message : String(e)}`),
        )
      } else {
        const v = makeVideo(videoBRef)
        v.src = URL.createObjectURL(file)
        v.play().then(() => engine.setVideoSourceB(v))
      }
    }
  }

  return fatal !== null ? (
    <div style={fatalWrapStyle}>
      <div style={fatalCardStyle}>
        <h1 style={{ fontSize: 18, margin: '0 0 12px', color: '#f66' }}>{fatal.title}</h1>
        <p style={{ margin: '0 0 14px' }}>{fatal.body}</p>
        {fatal.kind === 'unavailable' ? (
          <>
            <p style={{ margin: '0 0 14px', color: '#8888a0' }}>
              This app renders the entire NTSC signal path in WebGPU compute shaders, so a WebGPU-capable browser with
              working hardware acceleration is required — there is no 2D-canvas fallback.
            </p>
            <p style={{ margin: 0, color: '#8888a0' }}>
              Check support at{' '}
              <a href="https://caniuse.com/webgpu" style={{ color: '#7fd0a0' }} target="_blank" rel="noreferrer">
                caniuse.com/webgpu
              </a>
              .
            </p>
          </>
        ) : (
          <button style={{ ...btnStyle, borderColor: '#7fd0a0' }} onClick={() => location.reload()}>
            reload
          </button>
        )}
      </div>
    </div>
  ) : (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', background: '#000' }}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        {error !== '' && (
          <div style={{ position: 'absolute', top: 20, left: 20, color: '#f66', fontFamily: 'monospace' }}>
            {error}
          </div>
        )}
        <button style={fsBtnStyle} onClick={toggleFullscreen} title="toggle fullscreen (f)">
          {fullscreen ? '⤢ exit' : '⛶ fullscreen'}
        </button>
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 12,
            color: '#4a4',
            fontFamily: 'monospace',
            fontSize: 11,
          }}
        >
          {fps.toFixed(0)} fps · {res}
        </div>
      </div>
      {fullscreen ? null : (
        <div style={panelStyle}>
          <h2 style={{ fontSize: 13, margin: '4px 0 10px' }}>video_feedback — NTSC signal path</h2>

          <Section title="Performance">
            <Slider
              label="render scale"
              unit="x"
              min={0.25}
              max={2}
              step={0.05}
              value={renderScale}
              defaultValue={1}
              onChange={setScale}
            />
            <div style={{ color: '#666', margin: '2px 0' }}>lower = faster · {res}</div>
          </Section>

          <Section title="Source">
            {(['bars', 'sweep', 'file', 'webcam'] as const).map((mode) => (
              <button
                key={mode}
                style={{ ...btnStyle, borderColor: sourceMode === mode ? '#7fd0a0' : '#3a3a44' }}
                onClick={() => selectSource(mode)}
              >
                {mode}
              </button>
            ))}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*"
              style={{ display: 'none' }}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </Section>

          <Section title="Source B (dirty mix)">
            {(['none', 'bars', 'sweep', 'file'] as const).map((mode) => (
              <button
                key={mode}
                style={{ ...btnStyle, borderColor: sourceBMode === mode ? '#7fd0a0' : '#3a3a44' }}
                onClick={() => selectSourceB(mode)}
              >
                {mode}
              </button>
            ))}
            <input
              ref={fileInputBRef}
              type="file"
              accept="video/*,image/*"
              style={{ display: 'none' }}
              onChange={(e) => onFileB(e.target.files?.[0])}
            />
          </Section>

          <Section title="Presets">
            {Object.entries(BUILTIN_PRESETS).map(([name, patch]) => (
              <button key={name} style={btnStyle} onClick={() => applyControls(presetControls(patch))}>
                {name}
              </button>
            ))}
            <button
              style={{ ...btnStyle, borderColor: '#a05050' }}
              onClick={() => applyControls({ ...DEFAULT_CONTROLS })}
            >
              reset all
            </button>
            <button style={{ ...btnStyle, borderColor: copied ? '#7fd0a0' : '#3a3a44' }} onClick={copyLink}>
              {copied ? 'copied!' : 'copy link'}
            </button>
            <div style={{ color: '#666', margin: '4px 0' }}>keys 1-8 load slot, shift+1-8 save · f fullscreen</div>
          </Section>

          {GROUPS.map((group) => (
            <Section key={group.name} title={group.name}>
              {group.sliders.map((s) => (
                <Slider
                  key={s.key}
                  label={s.label}
                  unit={s.unit}
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={values[s.key]}
                  defaultValue={DEFAULT_CONTROLS[s.key]}
                  onChange={(v) => setControl(s.key, v)}
                />
              ))}
            </Section>
          ))}
        </div>
      )}
    </div>
  )
}
