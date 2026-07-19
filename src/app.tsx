import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { DEFAULT_CONTROLS, Engine } from './gpu/pipeline'
import type { ControlKey, Controls } from './gpu/pipeline'
import { smpteBars, sweep } from './sources/pattern'
import { GROUPS, type Group } from './ui/controls'
import { SYNCABLE_KEYS, SYNC_DIVISIONS, createMidi, syncedValue } from './ui/midi'
import type { BindingMap, MidiManager, MidiStatus } from './ui/midi'
import { changedKeys, loadSlots, matchPreset, PRESETS, presetControls, saveSlot } from './ui/presets'
import styles from './app.module.css'

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ')

// useSyncExternalStore fallbacks for the window before the async engine exists.
const subscribeNever = () => () => {}
const getDefaultControls = (): Controls => DEFAULT_CONTROLS

const LABEL_BY_KEY = new Map(GROUPS.flatMap((g) => g.sliders).map((s) => [s.key, s.label]))
// A/B mix groups live next to the Input row (shown when B is on); the rest fill
// the collapsible group list at the bottom of the panel.
const AB_GROUPS = GROUPS.filter((g) => g.ab)
const MAIN_GROUPS = GROUPS.filter((g) => !g.ab)
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

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  )
}

function Section(props: { title: string; children: React.ReactNode; flagged?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)
  return (
    <div>
      <h3 className={cx(styles.head, props.flagged && styles.flagged)} onClick={() => setOpen((o) => !o)}>
        <span>
          {props.flagged ? '● ' : ''}
          {props.title}
        </span>
        <span className={styles.caret}>{open ? '▾' : '▸'}</span>
      </h3>
      {open ? props.children : null}
    </div>
  )
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
  return (
    <label className={cx(styles.slider, props.highlight && styles.sliderHi)}>
      <span className={styles.sliderTop}>
        <span className={props.highlight ? styles.labelHi : undefined}>{props.label}</span>
        <span className={styles.value}>
          {props.value.toFixed(props.step < 0.01 ? 3 : props.step < 1 ? 2 : 0)}
          {props.unit}
          {sync ? (
            <button
              title={sync.label === null ? 'lock to MIDI clock' : `clock-synced (${sync.label}) — click to change`}
              className={cx(
                styles.icon,
                sync.label !== null && (sync.live ? styles.iconOn : styles.iconSyncSet),
              )}
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
              className={cx(styles.icon, midi.armed ? styles.iconOn : midi.label !== null && styles.iconMidiSet)}
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
            className={cx(styles.reset, props.value === props.defaultValue && styles.resetDef)}
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
        className={styles.range}
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

const SOURCE_MODES = ['bars', 'sweep', 'file', 'webcam'] as const
const SOURCE_B_MODES = ['none', 'bars', 'sweep', 'file'] as const
type SourceMode = (typeof SOURCE_MODES)[number]
type SourceBMode = (typeof SOURCE_B_MODES)[number]
// Full labels shown inside the dropdowns so each option explains what it is.
const SOURCE_DESC: Record<SourceMode | SourceBMode, string> = {
  none: 'Off — no second source',
  bars: 'Color bars — SMPTE test pattern',
  sweep: 'Sweep — frequency zone plate',
  file: 'File… — open an image or video',
  webcam: 'Webcam — live camera',
}
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
  const [engine, setEngine] = useState<Engine | null>(null)
  // The engine IS the store: React reads controls straight from it via
  // useSyncExternalStore, so there's no separate `values` copy to keep in sync.
  const controls = useSyncExternalStore(
    engine === null ? subscribeNever : engine.subscribeControls,
    engine === null ? getDefaultControls : engine.getControls,
  )
  const [sourceMode, setSourceMode] = useState<SourceMode>('bars')
  const [sourceBMode, setSourceBMode] = useState<SourceBMode>('bars')
  const [fullscreen, setFullscreen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
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

  const applyControls = (next: Controls) => {
    engineRef.current?.applyControls(next)
    const midi = midiRef.current
    if (midi) for (const k of Object.keys(next) as ControlKey[]) midi.setExternal(k, next[k])
  }

  const applyPreset = (name: string, patch: Partial<Controls>) => {
    applyControls(presetControls(patch))
    setLastPreset(name)
  }

  // Hold-to-compare: preview the clean defaults on the render path without
  // touching the store (sliders stay put), then restore from it on release.
  const startCompare = () => {
    engineRef.current?.preview({ ...DEFAULT_CONTROLS })
    setComparing(true)
  }
  const endCompare = () => {
    engineRef.current?.preview(null)
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
            setEngine(engine)
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
        setShowHelp(false)
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
    return div !== undefined && bpm !== null ? syncedValue(key, bpm, SYNC_DIVISIONS[div].beats) : controls[key]
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
      .filter((k) => controls[k] !== DEFAULT_CONTROLS[k])
      .map((k) => `${k}:${+controls[k].toFixed(4)}`)
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

  const active = matchPreset(controls)
  const hoverDef = hoverPreset === null ? undefined : PRESETS.find((p) => p.name === hoverPreset)
  const hoverKeys = hoverDef === undefined ? null : changedKeys(hoverDef.patch, controls)
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

  const renderGroup = (group: Group, defaultOpen: boolean) => (
    <Section
      key={group.name}
      title={group.name}
      defaultOpen={defaultOpen}
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
          midi={midiStatus === 'ready' ? { label: bindLabel(s.key), armed: armedKey === s.key, onArm: () => armMidi(s.key) } : undefined}
          sync={midiStatus === 'ready' && SYNCABLE_SET.has(s.key) ? { label: syncLabel(s.key), live: bpm !== null, onCycle: () => cycleSync(s.key) } : undefined}
        />
      ))}
    </Section>
  )

  return fatal !== null ? (
    <div className={styles.fatalWrap}>
      <div className={styles.fatalCard}>
        <h1 className={styles.fatalTitle}>{fatal.title}</h1>
        <p style={{ margin: '0 0 14px' }}>{fatal.body}</p>
        {fatal.kind === 'unavailable' ? (
          <>
            <p className={styles.muted} style={{ margin: '0 0 14px' }}>
              This app renders the entire NTSC signal path in WebGPU compute shaders, so a WebGPU-capable browser with
              working hardware acceleration is required — there is no 2D-canvas fallback.
            </p>
            <p className={styles.muted} style={{ margin: 0 }}>
              Check support at{' '}
              <a className={styles.link} href="https://caniuse.com/webgpu" target="_blank" rel="noreferrer">
                caniuse.com/webgpu
              </a>
              .
            </p>
          </>
        ) : (
          <button className={cx(styles.btn, styles.active)} onClick={() => location.reload()}>
            reload
          </button>
        )}
      </div>
    </div>
  ) : (
    <div className={styles.app}>
      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
        {error !== '' && <div className={styles.error}>{error}</div>}
        <div className={styles.overlayBar}>
          <button className={styles.overlayBtn} style={{ fontWeight: 700 }} onClick={() => setShowHelp(true)} title="help / about">
            ?
          </button>
          <button className={styles.overlayBtn} onClick={() => setShowAdvanced(true)} title="advanced settings">
            <GearIcon />
          </button>
          <button className={styles.overlayBtn} onClick={toggleFullscreen} title="toggle fullscreen (f)">
            {fullscreen ? '⤢ exit' : '⛶ fullscreen'}
          </button>
        </div>
        <div className={styles.stats}>
          {fps.toFixed(0)} fps · {res}
        </div>
      </div>
      {fullscreen ? null : (
        <div className={styles.panel}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>Phosphene — NTSC signal path</h2>
            <a className={styles.link} href="https://github.com/cmdcolin/phosphene" target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          </div>

          <div>
            <div className={cx(styles.head, styles.static)}>Input</div>
            <div className={styles.inputRow}>
              <span className={styles.tag} title="main source">
                A
              </span>
              <select
                className={styles.select}
                value={sourceMode}
                onChange={(e) => {
                  const m = SOURCE_MODES.find((x) => x === e.target.value)
                  if (m !== undefined) selectSource(m)
                }}
              >
                {SOURCE_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {SOURCE_DESC[mode]}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.inputRow}>
              <span className={styles.tag} title="second source, mixed in dirty">
                B
              </span>
              <select
                className={styles.select}
                value={sourceBMode}
                onChange={(e) => {
                  const m = SOURCE_B_MODES.find((x) => x === e.target.value)
                  if (m !== undefined) selectSourceB(m)
                }}
              >
                {SOURCE_B_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {SOURCE_DESC[mode]}
                  </option>
                ))}
              </select>
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
            {sourceBMode === 'none' ? (
              <div className={styles.hint}>pick a source B above to mix a second signal in.</div>
            ) : (
              AB_GROUPS.map((group) => renderGroup(group, true))
            )}
          </div>

          <Section title="Presets">
            {presetGroups.map((grp) => (
              <div key={grp.name} style={{ margin: '2px 0 4px' }}>
                <div className={styles.grpLabel}>{grp.name}</div>
                {grp.defs.map((p) => {
                  const isActive = active?.name === p.name
                  const isEdited = active === undefined && lastPreset === p.name
                  return (
                    <button
                      key={p.name}
                      title={p.blurb}
                      className={cx(styles.btn, isActive && styles.active, isEdited && styles.edited)}
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
            <div className={styles.caption}>{presetCaption}</div>
            <button
              onPointerDown={startCompare}
              onPointerUp={endCompare}
              onPointerLeave={endCompare}
              className={cx(styles.btn, comparing && styles.active)}
              title="hold to preview the clean signal, release to return (or hold C)"
            >
              {comparing ? 'showing clean…' : 'hold to compare'}
            </button>
            <button
              className={cx(styles.btn, styles.danger)}
              onClick={() => {
                applyControls({ ...DEFAULT_CONTROLS })
                setLastPreset(null)
              }}
            >
              reset all
            </button>
            <button className={cx(styles.btn, copied && styles.active)} onClick={copyLink}>
              {copied ? 'copied!' : 'copy link'}
            </button>
            <div className={styles.hint}>hover a preset to see its effect · keys 1-8 slots · f fullscreen</div>
          </Section>

          {/* MIDI only appears once enabled (from Advanced) — 99% of users never
              wire up a controller, so it stays out of the default panel. */}
          {midiStatus === 'ready' ? (
            <Section title="MIDI">
              <>
                <div className={styles.hint}>
                  {armedKey === null
                    ? 'click ⚟ on any slider, then move a knob to bind. knobs soft-take-over (no jumps).'
                    : `learning ${LABEL_BY_KEY.get(armedKey) ?? armedKey}… move a knob (Esc to cancel)`}
                </div>
                {Object.entries(midiBindings).map(([key, b]) => (
                  <div key={key} className={styles.midiRow}>
                    <span>
                      {LABEL_BY_KEY.get(key as ControlKey) ?? key} <span className={styles.blue}>· CC{b.controller}</span>
                      {b.channel === 0 ? '' : <span className={styles.dim}> ch{b.channel + 1}</span>}
                    </span>
                    <button className={styles.iconX} onClick={() => midiRef.current?.clearBinding(key as ControlKey)}>
                      ×
                    </button>
                  </div>
                ))}
                {Object.keys(midiBindings).length === 0 ? null : (
                  <button className={cx(styles.btn, styles.danger)} onClick={() => midiRef.current?.clearAll()}>
                    clear all bindings
                  </button>
                )}
                <div className={bpm === null ? styles.dim : styles.amber} style={{ margin: '8px 0 2px' }}>
                  {bpm === null ? 'clock ♩ — no signal' : `clock ♩ = ${bpm.toFixed(1)} BPM`}
                </div>
                <div className={styles.dim} style={{ margin: '0 0 2px' }}>
                  click ♩ on a rate slider (sweep, line offset) to lock it to the beat.
                </div>
              </>
            </Section>
          ) : null}

          {MAIN_GROUPS.map((group) => renderGroup(group, false))}
        </div>
      )}
      {showAdvanced ? (
        <div className={styles.backdrop} onClick={() => setShowAdvanced(false)}>
          <div className={styles.card} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cardRow}>
              <h2 className={styles.h2}>Advanced</h2>
              <button className={styles.btn} style={{ margin: 0 }} onClick={() => setShowAdvanced(false)}>
                close
              </button>
            </div>
            <Slider label="render scale" unit="x" min={0.25} max={2} step={0.05} value={renderScale} defaultValue={1} onChange={setScale} />
            <div className={styles.dim} style={{ margin: '2px 0 12px' }}>
              backing-store resolution · lower = faster · {res}
            </div>
            <div className={styles.subhead}>MIDI control</div>
            {midiStatus === 'idle' ? (
              <button className={styles.btn} style={{ margin: 0 }} onClick={() => midiRef.current?.enable()}>
                enable MIDI
              </button>
            ) : null}
            {midiStatus === 'requesting' ? <div className={styles.muted}>requesting access…</div> : null}
            {midiStatus === 'unsupported' ? <div className={styles.warn}>Web MIDI not supported in this browser.</div> : null}
            {midiStatus === 'denied' ? (
              <div className={styles.err}>
                Access denied.{' '}
                <button className={styles.btn} style={{ margin: 0 }} onClick={() => midiRef.current?.enable()}>
                  retry
                </button>
              </div>
            ) : null}
            {midiStatus === 'ready' ? <div className={styles.ok}>enabled — bind knobs from the MIDI panel in the sidebar.</div> : null}
            <div className={styles.dim} style={{ margin: '4px 0 0' }}>
              map a hardware controller to any slider; sync rates to MIDI clock.
            </div>
          </div>
        </div>
      ) : null}
      {showHelp ? (
        <div className={styles.backdrop} onClick={() => setShowHelp(false)}>
          <div className={cx(styles.card, styles.cardWide)} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cardRow} style={{ marginBottom: 10 }}>
              <h2 style={{ fontSize: 15, margin: 0 }}>Phosphene</h2>
              <button className={styles.btn} style={{ margin: 0 }} onClick={() => setShowHelp(false)}>
                close
              </button>
            </div>
            <p className={styles.helpText}>
              A real-time simulator of the analog NTSC signal path — camera, tape, RF, and CRT — rendered entirely in WebGPU compute
              shaders. Feed it a pattern, image, video, or your webcam and degrade it however you like.
            </p>
            <div className={styles.helpHead}>Getting started</div>
            <ol className={styles.helpList}>
              <li>
                Pick an <b>Input</b> (A is the main source; B mixes a second in).
              </li>
              <li>
                Click a <b>Preset</b> for an instant look, then tweak the sliders below.
              </li>
              <li>Hover a preset to preview which knobs it changes.</li>
            </ol>
            <div className={styles.helpHead}>Keyboard</div>
            <ul className={styles.helpList}>
              <li>
                <b>1–8</b> recall a slot · <b>Shift+1–8</b> save the current look to a slot
              </li>
              <li>
                <b>C</b> (hold) compare against the clean signal
              </li>
              <li>
                <b>F</b> fullscreen · <b>Esc</b> close dialogs
              </li>
            </ul>
            <div className={styles.helpHead}>More</div>
            <p className={styles.muted} style={{ margin: 0 }}>
              The <b>gear</b> icon holds render scale and MIDI setup. Source code and notes on{' '}
              <a className={styles.link} href="https://github.com/cmdcolin/phosphene" target="_blank" rel="noreferrer">
                GitHub ↗
              </a>
              .
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
