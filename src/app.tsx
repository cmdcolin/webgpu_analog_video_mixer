import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CONTROLS, Engine } from './gpu/pipeline'
import type { ControlKey, Controls } from './gpu/pipeline'
import { smpteBars, sweep } from './sources/pattern'
import { GROUPS } from './ui/controls'
import { SYNCABLE_KEYS, SYNC_DIVISIONS, createMidi, syncedValue } from './ui/midi'
import type { BindingMap, MidiManager, MidiStatus } from './ui/midi'
import { changedKeys, loadSlots, matchPreset, PRESETS, presetControls, saveSlot } from './ui/presets'

const LABEL_BY_KEY = new Map(GROUPS.flatMap((g) => g.sliders).map((s) => [s.key, s.label]))
// Deep signal-path groups: real but rarely-touched knobs. Start collapsed so the
// panel opens calm; presets set most of these anyway.
const DEEP_GROUPS = new Set(['Tape / Channel', 'VHS Chroma', 'Timebase', 'Sync', 'Decoder', 'Display'])
const SYNCABLE_SET = new Set<ControlKey>(SYNCABLE_KEYS)

// Which rate controls are clock-locked, and to which SYNC_DIVISIONS index.
type SyncMap = Partial<Record<ControlKey, number>>
const SYNC_STORE = 'video_feedback_midi_sync'
function loadSync(): SyncMap {
  const raw = localStorage.getItem(SYNC_STORE)
  return raw === null ? {} : (JSON.parse(raw) as SyncMap)
}
function omitKey(map: SyncMap, key: ControlKey): SyncMap {
  const out: SyncMap = {}
  for (const [k, v] of Object.entries(map)) if (k !== key) out[k as ControlKey] = v
  return out
}

// UI font for labels/headers/prose; mono reserved for numeric readouts where
// digit alignment (and the technical vibe) is actually earned.
const FONT_UI = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const FONT_MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace"

const panelStyle: React.CSSProperties = {
  width: 300,
  overflowY: 'auto',
  padding: '10px 14px',
  background: '#16161a',
  color: '#c8c8d0',
  fontFamily: FONT_UI,
  fontSize: 12,
  flexShrink: 0,
}

const btnStyle: React.CSSProperties = {
  background: '#26262e',
  color: '#c8c8d0',
  border: '1px solid #3a3a44',
  borderRadius: 3,
  padding: '3px 8px',
  margin: '2px 3px 2px 0',
  fontFamily: FONT_UI,
  fontSize: 12,
  cursor: 'pointer',
}

// The Input block is deliberately styled unlike the effect sections: a calm
// card with rows, not a collapsible header bar — "what am I feeding in" reads
// differently from "how is it degraded".
const inputCardStyle: React.CSSProperties = {
  background: '#1b1b22',
  border: '1px solid #2c2c38',
  borderRadius: 6,
  padding: '8px 10px 10px',
  margin: '4px 0 6px',
}

const inputHeadStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#7f9fd0',
  fontWeight: 600,
  letterSpacing: '0.04em',
  margin: '0 0 6px',
}

const inputRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  margin: '3px 0',
}

const inputTagStyle: React.CSSProperties = {
  width: 14,
  color: '#6a6a80',
  fontFamily: FONT_MONO,
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
}

const chipStyle: React.CSSProperties = {
  flex: 1,
  background: '#26262e',
  color: '#c8c8d0',
  border: '1px solid #3a3a44',
  borderRadius: 3,
  padding: '3px 0',
  fontFamily: FONT_UI,
  fontSize: 11,
  cursor: 'pointer',
}

const chipActiveStyle: React.CSSProperties = {
  borderColor: '#7fd0a0',
  color: '#7fd0a0',
  background: '#20302a',
}

const overlayBarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  display: 'flex',
  gap: 6,
}

const overlayBtnStyle: React.CSSProperties = {
  background: 'rgba(22,22,26,0.6)',
  color: '#c8c8d0',
  border: '1px solid #3a3a44',
  borderRadius: 3,
  padding: '4px 9px',
  fontFamily: FONT_UI,
  fontSize: 12,
  cursor: 'pointer',
}

const dialogBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
}

const dialogCardStyle: React.CSSProperties = {
  width: 340,
  maxWidth: '90vw',
  background: '#16161a',
  border: '1px solid #3a3a44',
  borderRadius: 8,
  padding: '18px 20px',
  color: '#c8c8d0',
  fontFamily: 'monospace',
  fontSize: 11,
}

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 12,
  margin: '14px 0 4px',
  padding: '3px 2px',
  color: '#9a9ab0',
  borderBottom: '1px solid #2a2a34',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  userSelect: 'none',
}

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  )
}

function Section(props: { title: string; children: React.ReactNode; flagged?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)
  const head = props.flagged ? { ...sectionHeadStyle, borderColor: '#7fd0a0', color: '#7fd0a0' } : sectionHeadStyle
  return (
    <div>
      <h3 style={head} onClick={() => setOpen((o) => !o)}>
        <span>
          {props.flagged ? '● ' : ''}
          {props.title}
        </span>
        <span style={{ color: '#8a8aa8', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
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
  midi?: { label: string | null; armed: boolean; onArm: () => void }
  sync?: { label: string | null; live: boolean; onCycle: () => void }
  highlight?: boolean
}) {
  const midi = props.midi
  const sync = props.sync
  const locked = sync?.label !== null && sync?.label !== undefined && sync.live
  const labelStyle: React.CSSProperties = props.highlight
    ? { display: 'block', margin: '6px 0 6px -8px', borderLeft: '2px solid #7fd0a0', paddingLeft: 6 }
    : { display: 'block', margin: '6px 0' }
  return (
    <label style={labelStyle}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={props.highlight ? { color: '#7fd0a0' } : undefined}>{props.label}</span>
        <span style={{ color: '#7fd0a0', fontFamily: FONT_MONO }}>
          {props.value.toFixed(props.step < 0.01 ? 3 : props.step < 1 ? 2 : 0)}
          {props.unit}
          {sync ? (
            <button
              title={sync.label === null ? 'lock to MIDI clock' : `clock-synced (${sync.label}) — click to change`}
              style={{
                background: 'none',
                border: 'none',
                color: sync.label === null ? '#4a4a58' : sync.live ? '#e0b040' : '#8a7a40',
                cursor: 'pointer',
                fontSize: 10,
                padding: '0 0 0 6px',
              }}
              onClick={(e) => {
                e.preventDefault()
                sync.onCycle()
              }}
            >
              {sync.label === null ? '♩' : `♩${sync.label}`}
            </button>
          ) : null}
          {midi ? (
            <button
              title={midi.label === null ? 'assign a MIDI control' : `MIDI CC${midi.label} — click to relearn`}
              style={{
                background: 'none',
                border: 'none',
                color: midi.armed ? '#e0b040' : midi.label === null ? '#4a4a58' : '#7f9fd0',
                cursor: 'pointer',
                fontSize: 10,
                padding: '0 0 0 6px',
              }}
              onClick={(e) => {
                e.preventDefault()
                midi.onArm()
              }}
            >
              {midi.armed ? 'learn…' : midi.label === null ? '⚟' : `CC${midi.label}`}
            </button>
          ) : null}
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
        style={{ width: '100%', opacity: locked ? 0.45 : 1 }}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={locked}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

type SourceMode = 'bars' | 'sweep' | 'file' | 'webcam'
type SourceBMode = 'none' | 'bars' | 'sweep' | 'file'
interface Fatal { title: string; body: string; kind: 'unavailable' | 'lost' }

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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [copied, setCopied] = useState(false)
  const [renderScale, setRenderScale] = useState(1)
  const renderScaleRef = useRef(1)
  const [res, setRes] = useState('')
  const midiRef = useRef<MidiManager | null>(null)
  const [midiStatus, setMidiStatus] = useState<MidiStatus>('idle')
  const [midiBindings, setMidiBindings] = useState<BindingMap>({})
  const [armedKey, setArmedKey] = useState<ControlKey | null>(null)
  const [bpm, setBpm] = useState<number | null>(null)
  const [syncMap, setSyncMap] = useState<SyncMap>(loadSync)
  const [hoverPreset, setHoverPreset] = useState<string | null>(null)
  const [lastPreset, setLastPreset] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)
  const compareRef = useRef<Controls | null>(null)
  // Mirror the latest values so the keyboard compare handler (bound once) reads
  // fresh state without re-binding.
  const valuesRef = useRef(values)
  valuesRef.current = values

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
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  const applyControls = (controls: Controls) => {
    setValues(controls)
    engineRef.current?.applyControls(controls)
    const midi = midiRef.current
    if (midi) for (const k of Object.keys(controls) as ControlKey[]) midi.setExternal(k, controls[k])
  }

  const applyPreset = (name: string, patch: Partial<Controls>) => {
    applyControls(presetControls(patch))
    setLastPreset(name)
  }

  // Hold-to-compare: momentarily push the clean defaults to the engine without
  // touching React state (sliders stay put), then restore on release.
  const startCompare = () => {
    const engine = engineRef.current
    if (engine && compareRef.current === null) {
      compareRef.current = { ...valuesRef.current }
      engine.applyControls({ ...DEFAULT_CONTROLS })
      setComparing(true)
    }
  }
  const endCompare = () => {
    const engine = engineRef.current
    const saved = compareRef.current
    if (engine && saved !== null) engine.applyControls(saved)
    compareRef.current = null
    setComparing(false)
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
            const q = new URLSearchParams(location.search)
            const preset = q.get('set')
            if (preset !== null) {
              const patch: Partial<Controls> = {}
              for (const pair of preset.split(',')) {
                const [k, v] = pair.split(':')
                const n = Number(v)
                if (k in DEFAULT_CONTROLS && Number.isFinite(n)) patch[k as ControlKey] = n
              }
              setValues((prev) => ({ ...prev, ...patch }))
              engine.applyControls(patch)
            }
            if (q.get('src') === 'sweep') {
              engine.setImageSource(sweep())
              setSourceMode('sweep')
            }
            if (q.get('src') === 'webcam') selectSource('webcam')
            // Source B (bars is the default, so only 'none'/'sweep' are serialized)
            const srcb = q.get('srcb')
            if (srcb === 'none') {
              engine.setSourceBEnabled(false)
              setSourceBMode('none')
            } else if (srcb === 'sweep') {
              engine.setImageSourceB(sweep())
              setSourceBMode('sweep')
            }
            const vurl = q.get('vurl')
            if (vurl !== null) {
              const v = makeVideo()
              v.src = vurl
              v.play().then(() => engine.setVideoSource(v)).catch(() => {})
              setSourceMode('file')
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
    // Mount-once: creates the single engine and reads URL params. selectSource
    // is stable enough for the one-shot ?src=webcam path; re-running on its
    // identity would tear down and rebuild the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // MIDI is an imperative external system; the manager lives outside React and
  // pushes changes back in through these stable setters. Created once.
  useEffect(() => {
    const midi = createMidi({
      onControl: (key, v) => {
        setValues((prev) => ({ ...prev, [key]: v }))
        engineRef.current?.setControl(key, v)
      },
      onStatus: setMidiStatus,
      onBindings: setMidiBindings,
      onArmed: setArmedKey,
      onTempo: setBpm,
    })
    midiRef.current = midi
    return () => {
      midi.destroy()
      midiRef.current = null
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const engine = engineRef.current
      const typing = e.target instanceof HTMLInputElement
      if (e.key === 'Escape') {
        setShowAdvanced(false)
        midiRef.current?.arm(null)
      } else if (!typing && e.key === 'f') {
        toggleFullscreen()
      } else if (!typing && e.key === 'c' && !e.repeat) {
        startCompare()
      } else if (!typing && engine && e.key >= '1' && e.key <= '8') {
        const slot = Number(e.key)
        if (e.shiftKey) {
          saveSlot(slot, engine.controls)
        } else {
          const stored = loadSlots()[String(slot)]
          // loadSlots()'s type is optimistic; a slot may be empty at runtime.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (stored) applyControls({ ...DEFAULT_CONTROLS, ...stored })
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'c') endCompare()
    }
    const onFs = () => setFullscreen(document.fullscreenElement !== null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [])

  const setControl = (key: ControlKey, v: number) => {
    setValues((prev) => ({ ...prev, [key]: v }))
    engineRef.current?.setControl(key, v)
    midiRef.current?.setExternal(key, v)
  }

  const armMidi = (key: ControlKey) => {
    const midi = midiRef.current
    if (midi) midi.arm(armedKey === key ? null : key)
  }

  const bindLabel = (key: ControlKey): string | null => {
    const b = midiBindings[key]
    return b === undefined ? null : String(b.controller)
  }

  const syncLabel = (key: ControlKey): string | null => {
    const div = syncMap[key]
    return div === undefined ? null : SYNC_DIVISIONS[div].label
  }

  // A clock-locked control's value is a pure function of tempo + division, so
  // compute it during render instead of storing it in state.
  const displayValue = (key: ControlKey): number => {
    const div = syncMap[key]
    return div !== undefined && bpm !== null ? syncedValue(key, bpm, SYNC_DIVISIONS[div].beats) : values[key]
  }
  const wipeRateValue = displayValue('wipeRate')
  const bLineHzValue = displayValue('bLineHz')

  // The one genuine synchronization: push each locked value to the external GPU
  // engine (and MIDI takeover state) whenever the rendered value changes.
  useEffect(() => {
    engineRef.current?.setControl('wipeRate', wipeRateValue)
    midiRef.current?.setExternal('wipeRate', wipeRateValue)
  }, [wipeRateValue])
  useEffect(() => {
    engineRef.current?.setControl('bLineHz', bLineHzValue)
    midiRef.current?.setExternal('bLineHz', bLineHzValue)
  }, [bLineHzValue])

  // Cycle a control through off → each division → off, persisting the choice.
  const cycleSync = (key: ControlKey) => {
    setSyncMap((prev) => {
      const cur = prev[key]
      const nextIdx = cur === undefined ? 0 : cur + 1
      const next = nextIdx >= SYNC_DIVISIONS.length ? omitKey(prev, key) : { ...prev, [key]: nextIdx }
      localStorage.setItem(SYNC_STORE, JSON.stringify(next))
      return next
    })
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
    if (sourceBMode === 'none' || sourceBMode === 'sweep') q.push(`srcb=${sourceBMode}`)
    const url = `${location.origin}${location.pathname}${q.length ? `?${q.join('&')}` : ''}`
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {})
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
    const engine = engineRef.current
    if (engine) {
      // For file, wait until a file is actually picked before touching state:
      // cancelling the OS dialog then leaves the current source untouched.
      if (mode === 'file') {
        fileInputRef.current?.click()
      } else {
        stopVideo()
        setSourceMode(mode)
        if (mode === 'bars') engine.setImageSource(smpteBars())
        else if (mode === 'sweep') engine.setImageSource(sweep())
        else {
          navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } }).then(
            (stream) => {
              const v = makeVideo()
              v.srcObject = stream
              v.play().then(() => engine.setVideoSource(v)).catch(() => {})
            },
            (e: unknown) => setError(`webcam: ${e instanceof Error ? e.message : String(e)}`),
          )
        }
      }
    }
  }

  const onFile = (file: File | undefined) => {
    const engine = engineRef.current
    if (file && engine) {
      stopVideo()
      setSourceMode('file')
      if (file.type.startsWith('image/')) {
        createImageBitmap(file).then(
          (bmp) => engine.setImageSource(bmp, bmp.width / bmp.height),
          (e: unknown) => setError(`image: ${e instanceof Error ? e.message : String(e)}`),
        )
      } else {
        const v = makeVideo()
        v.src = URL.createObjectURL(file)
        v.play().then(() => engine.setVideoSource(v)).catch(() => {})
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
          (bmp) => engine.setImageSourceB(bmp),
          (e: unknown) => setError(`image: ${e instanceof Error ? e.message : String(e)}`),
        )
      } else {
        const v = makeVideo(videoBRef)
        v.src = URL.createObjectURL(file)
        v.play().then(() => engine.setVideoSourceB(v)).catch(() => {})
      }
    }
  }

  const active = matchPreset(values)
  const hoverDef = hoverPreset === null ? undefined : PRESETS.find((p) => p.name === hoverPreset)
  const hoverKeys = hoverDef === undefined ? null : changedKeys(hoverDef.patch, values)
  const presetGroups = PRESETS.reduce<{ name: string; defs: typeof PRESETS }[]>((acc, p) => {
    const g = acc.find((x) => x.name === p.group)
    if (g === undefined) acc.push({ name: p.group, defs: [p] })
    else g.defs.push(p)
    return acc
  }, [])
  const changedCount = hoverKeys === null ? 0 : hoverKeys.size
  const presetCaption = hoverDef
    ? `${hoverDef.blurb} · changes ${changedCount} knob${changedCount === 1 ? '' : 's'}`
    : active
      ? active.blurb
      : lastPreset === null
        ? 'hover a preset to preview what it changes; click to apply.'
        : `modified from "${lastPreset}"`

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
        <div style={overlayBarStyle}>
          <button
            style={{ ...overlayBtnStyle, display: 'flex', alignItems: 'center' }}
            onClick={() => setShowAdvanced(true)}
            title="advanced settings"
          >
            <GearIcon />
          </button>
          <button style={overlayBtnStyle} onClick={toggleFullscreen} title="toggle fullscreen (f)">
            {fullscreen ? '⤢ exit' : '⛶ fullscreen'}
          </button>
        </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '4px 0 10px' }}>
            <h2 style={{ fontSize: 13, margin: 0 }}>Phosphene — NTSC signal path</h2>
            <a
              href="https://github.com/cmdcolin/phosphene"
              target="_blank"
              rel="noreferrer"
              style={{ color: '#7fd0a0', fontSize: 11 }}
            >
              GitHub ↗
            </a>
          </div>

          <div style={inputCardStyle}>
            <div style={inputHeadStyle}>Input</div>
            <div style={inputRowStyle}>
              <span style={inputTagStyle}>A</span>
              {(['bars', 'sweep', 'file', 'webcam'] as const).map((mode) => (
                <button
                  key={mode}
                  style={{ ...chipStyle, ...(sourceMode === mode ? chipActiveStyle : null) }}
                  onClick={() => selectSource(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div style={inputRowStyle}>
              <span style={inputTagStyle} title="dirty mix source">B</span>
              {(['none', 'bars', 'sweep', 'file'] as const).map((mode) => (
                <button
                  key={mode}
                  style={{ ...chipStyle, ...(sourceBMode === mode ? chipActiveStyle : null) }}
                  onClick={() => selectSourceB(mode)}
                >
                  {mode === 'none' ? 'off' : mode}
                </button>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                onFile(e.target.files?.[0])
                e.target.value = '' // allow re-picking the same file
              }}
            />
            <input
              ref={fileInputBRef}
              type="file"
              accept="video/*,image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                onFileB(e.target.files?.[0])
                e.target.value = '' // allow re-picking the same file
              }}
            />
          </div>

          <Section title="Presets">
            {presetGroups.map((grp) => (
              <div key={grp.name} style={{ margin: '2px 0 4px' }}>
                <div
                  style={{
                    color: '#7a7a90',
                    fontSize: 10,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    margin: '4px 0 2px',
                  }}
                >
                  {grp.name}
                </div>
                {grp.defs.map((p) => {
                  const isActive = active?.name === p.name
                  const isEdited = active === undefined && lastPreset === p.name
                  return (
                    <button
                      key={p.name}
                      title={p.blurb}
                      style={{
                        ...btnStyle,
                        borderColor: isActive ? '#7fd0a0' : isEdited ? '#7f7f50' : '#3a3a44',
                        color: isActive ? '#7fd0a0' : '#c8c8d0',
                      }}
                      onClick={() => applyPreset(p.name, p.patch)}
                      onMouseEnter={() => setHoverPreset(p.name)}
                      onMouseLeave={() => setHoverPreset((h) => (h === p.name ? null : h))}
                    >
                      {p.name}
                      {isEdited ? ' •' : ''}
                    </button>
                  )
                })}
              </div>
            ))}
            <div style={{ minHeight: 28, color: '#8a8aa8', margin: '4px 0', lineHeight: 1.4 }}>{presetCaption}</div>
            <button
              onPointerDown={startCompare}
              onPointerUp={endCompare}
              onPointerLeave={endCompare}
              style={{ ...btnStyle, borderColor: comparing ? '#7fd0a0' : '#3a3a44', color: comparing ? '#7fd0a0' : '#c8c8d0' }}
              title="hold to preview the clean signal, release to return (or hold C)"
            >
              {comparing ? 'showing clean…' : 'hold to compare'}
            </button>
            <button
              style={{ ...btnStyle, borderColor: '#a05050' }}
              onClick={() => {
                applyControls({ ...DEFAULT_CONTROLS })
                setLastPreset(null)
              }}
            >
              reset all
            </button>
            <button style={{ ...btnStyle, borderColor: copied ? '#7fd0a0' : '#3a3a44' }} onClick={copyLink}>
              {copied ? 'copied!' : 'copy link'}
            </button>
            <div style={{ color: '#666', margin: '4px 0' }}>hover a preset to see its effect · keys 1-8 slots · f fullscreen</div>
          </Section>

          <Section title="MIDI">
            {midiStatus === 'idle' ? (
              <button style={btnStyle} onClick={() => midiRef.current?.enable()}>
                enable MIDI
              </button>
            ) : null}
            {midiStatus === 'requesting' ? <div style={{ color: '#8888a0' }}>requesting access…</div> : null}
            {midiStatus === 'unsupported' ? (
              <div style={{ color: '#a08050' }}>Web MIDI not supported in this browser.</div>
            ) : null}
            {midiStatus === 'denied' ? (
              <div style={{ color: '#a05050' }}>
                Access denied.{' '}
                <button style={{ ...btnStyle, margin: 0 }} onClick={() => midiRef.current?.enable()}>
                  retry
                </button>
              </div>
            ) : null}
            {midiStatus === 'ready' ? (
              <>
                <div style={{ color: '#666', margin: '4px 0' }}>
                  {armedKey === null
                    ? 'click ⚟ on any slider, then move a knob to bind. knobs soft-take-over (no jumps).'
                    : `learning ${LABEL_BY_KEY.get(armedKey) ?? armedKey}… move a knob (Esc to cancel)`}
                </div>
                {Object.entries(midiBindings).map(([key, b]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', margin: '2px 0' }}>
                    <span>
                      {LABEL_BY_KEY.get(key as ControlKey) ?? key}{' '}
                      <span style={{ color: '#7f9fd0' }}>· CC{b.controller}</span>
                      {b.channel === 0 ? '' : <span style={{ color: '#666' }}> ch{b.channel + 1}</span>}
                    </span>
                    <button
                      style={{ background: 'none', border: 'none', color: '#a05050', cursor: 'pointer', fontSize: 11 }}
                      onClick={() => midiRef.current?.clearBinding(key as ControlKey)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {Object.keys(midiBindings).length === 0 ? null : (
                  <button style={{ ...btnStyle, borderColor: '#a05050' }} onClick={() => midiRef.current?.clearAll()}>
                    clear all bindings
                  </button>
                )}
                <div style={{ margin: '8px 0 2px', color: bpm === null ? '#666' : '#e0b040' }}>
                  {bpm === null ? 'clock ♩ — no signal' : `clock ♩ = ${bpm.toFixed(1)} BPM`}
                </div>
                <div style={{ color: '#666', margin: '0 0 2px' }}>
                  click ♩ on a rate slider (sweep, line offset) to lock it to the beat.
                </div>
              </>
            ) : null}
          </Section>

          {GROUPS.map((group) => (
            <Section
              key={group.name}
              title={group.name}
              defaultOpen={!DEEP_GROUPS.has(group.name)}
              flagged={hoverKeys !== null && group.sliders.some((s) => hoverKeys.has(s.key))}
            >
              {group.sliders.map((s) => (
                <Slider
                  key={s.key}
                  label={s.label}
                  unit={s.unit}
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={displayValue(s.key)}
                  defaultValue={DEFAULT_CONTROLS[s.key]}
                  onChange={(v) => setControl(s.key, v)}
                  highlight={hoverKeys?.has(s.key) ?? false}
                  midi={
                    midiStatus === 'ready'
                      ? { label: bindLabel(s.key), armed: armedKey === s.key, onArm: () => armMidi(s.key) }
                      : undefined
                  }
                  sync={
                    midiStatus === 'ready' && SYNCABLE_SET.has(s.key)
                      ? { label: syncLabel(s.key), live: bpm !== null, onCycle: () => cycleSync(s.key) }
                      : undefined
                  }
                />
              ))}
            </Section>
          ))}
        </div>
      )}
      {showAdvanced ? (
        <div style={dialogBackdropStyle} onClick={() => setShowAdvanced(false)}>
          <div style={dialogCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <h2 style={{ fontSize: 13, margin: 0 }}>Advanced</h2>
              <button style={{ ...btnStyle, margin: 0 }} onClick={() => setShowAdvanced(false)}>
                close
              </button>
            </div>
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
            <div style={{ color: '#666', margin: '2px 0' }}>
              backing-store resolution · lower = faster · {res}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
