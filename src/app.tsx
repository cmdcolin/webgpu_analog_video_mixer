import { useEffect, useState, useSyncExternalStore } from 'react'
import { DEFAULT_CONTROLS } from './gpu/pipeline'
import type { ControlKey, Controls } from './gpu/pipeline'
import { GROUPS, type Group } from './ui/controls'
import { SYNCABLE_KEYS, SYNC_DIVISIONS, omit, syncedValue } from './ui/midi'
import { presetControls } from './ui/presets'
import { Section } from './ui/Section'
import { Slider } from './ui/Slider'
import { Stage } from './ui/Stage'
import { FatalScreen } from './ui/FatalScreen'
import { HelpDialog } from './ui/HelpDialog'
import { WebcamDialog } from './ui/WebcamDialog'
import { AdvancedDialog } from './ui/AdvancedDialog'
import { InputSection } from './ui/InputSection'
import { PresetsSection } from './ui/PresetsSection'
import { MidiSection } from './ui/MidiSection'
import { useEngine } from './ui/useEngine'
import { useMidi } from './ui/useMidi'
import styles from './app.module.css'

// useSyncExternalStore fallbacks for the window before the async engine exists.
const subscribeNever = () => () => {}
const getDefaultControls = (): Controls => DEFAULT_CONTROLS

const MAIN_GROUPS = GROUPS.filter(g => !g.ab)
const SYNCABLE_SET = new Set<ControlKey>(SYNCABLE_KEYS)

// Which rate controls are clock-locked, and to which SYNC_DIVISIONS index.
type SyncMap = Partial<Record<ControlKey, number>>
const SYNC_STORE = 'video_feedback_midi_sync'
function loadSync(): SyncMap {
  const raw = localStorage.getItem(SYNC_STORE)
  return raw === null ? {} : (JSON.parse(raw) as SyncMap)
}

export function App() {
  const eng = useEngine()
  const engineRef = eng.engineRef
  const {
    status: midiStatus,
    bindings: midiBindings,
    armedKey,
    bpm,
    writeControl,
    writeControls,
    enable: enableMidi,
    toggleArm,
    disarm,
    clearBinding,
    clearAll,
  } = useMidi(engineRef)
  // The engine IS the store: React reads controls straight from it via
  // useSyncExternalStore, so there's no separate `values` copy to keep in sync.
  const controls = useSyncExternalStore(
    eng.engine === null ? subscribeNever : eng.engine.subscribeControls,
    eng.engine === null ? getDefaultControls : eng.engine.getControls,
  )
  const [fullscreen, setFullscreen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [syncMap, setSyncMap] = useState<SyncMap>(loadSync)
  const [lastPreset, setLastPreset] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  const applyPreset = (name: string, patch: Partial<Controls>) => {
    writeControls(presetControls(patch))
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
    const onKey = (e: KeyboardEvent) => {
      // Range sliders are HTMLInputElements too, so exclude them — otherwise a
      // focused slider swallows f/c. Only real text entry should block shortcuts.
      const typing =
        e.target instanceof HTMLInputElement && e.target.type !== 'range'
      if (e.key === 'Escape') {
        setShowAdvanced(false)
        setShowHelp(false)
        disarm()
      } else if (!typing && e.key === 'f') {
        toggleFullscreen()
      } else if (!typing && e.key === 'c' && !e.repeat) {
        startCompare()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'c') endCompare()
    }
    const onFs = () => setFullscreen(document.fullscreenElement !== null)
    // Restored from bfcache: the GPUDevice captured before navigating away is
    // dead, so the canvas would render frozen. Reload to build a fresh engine.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) location.reload()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('fullscreenchange', onFs)
    }
    // Mount-once: global listeners subscribed a single time. The handlers they
    // close over (disarm/compare/fullscreen) act through stable refs, so
    // re-subscribing on their identity would only thrash listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    return div !== undefined && bpm !== null
      ? syncedValue(key, bpm, SYNC_DIVISIONS[div].beats)
      : controls[key]
  }
  const wipeRateValue = displayValue('wipeRate')
  const bLineHzValue = displayValue('bLineHz')

  // The one genuine synchronization: push each locked value to the external GPU
  // engine (and MIDI takeover state) whenever the rendered value changes.
  useEffect(
    () => writeControl('wipeRate', wipeRateValue),
    [writeControl, wipeRateValue],
  )
  useEffect(
    () => writeControl('bLineHz', bLineHzValue),
    [writeControl, bLineHzValue],
  )

  // Cycle a control through off → each division → off, persisting the choice.
  const cycleSync = (key: ControlKey) => {
    setSyncMap(prev => {
      const cur = prev[key]
      const nextIdx = cur === undefined ? 0 : cur + 1
      const next =
        nextIdx >= SYNC_DIVISIONS.length
          ? omit(prev, key)
          : { ...prev, [key]: nextIdx }
      localStorage.setItem(SYNC_STORE, JSON.stringify(next))
      return next
    })
  }

  // Serialize non-default controls into the ?set= URL the loader already reads.
  const copyLink = () => {
    const set = (Object.keys(DEFAULT_CONTROLS) as ControlKey[])
      .filter(k => controls[k] !== DEFAULT_CONTROLS[k])
      .map(k => `${k}:${+controls[k].toFixed(4)}`)
    // URLSearchParams so values with spaces (src=tv static) get encoded.
    const q = new URLSearchParams()
    if (set.length) q.set('set', set.join(','))
    if (eng.sourceMode !== 'bars' && eng.sourceMode !== 'file')
      q.set('src', eng.sourceMode)
    if (eng.sourceBMode === 'bars' || eng.sourceBMode === 'sweep')
      q.set('srcb', eng.sourceBMode)
    const query = q.toString()
    const url = `${location.origin}${location.pathname}${query ? `?${query}` : ''}`
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {})
  }

  const renderGroup = (group: Group, defaultOpen: boolean) => (
    <Section key={group.name} title={group.name} defaultOpen={defaultOpen}>
      {group.sliders.map(s => (
        <Slider
          key={s.key}
          label={s.label}
          unit={s.unit}
          min={s.min}
          max={s.max}
          step={s.step}
          value={displayValue(s.key)}
          defaultValue={DEFAULT_CONTROLS[s.key]}
          onChange={v => writeControl(s.key, v)}
          midi={
            midiStatus === 'ready'
              ? {
                  label: bindLabel(s.key),
                  armed: armedKey === s.key,
                  onArm: () => toggleArm(s.key),
                }
              : undefined
          }
          sync={
            midiStatus === 'ready' && SYNCABLE_SET.has(s.key)
              ? {
                  label: syncLabel(s.key),
                  live: bpm !== null,
                  onCycle: () => cycleSync(s.key),
                }
              : undefined
          }
        />
      ))}
    </Section>
  )

  return eng.fatal !== null ? (
    <FatalScreen fatal={eng.fatal} />
  ) : (
    <div className={styles.app}>
      <Stage
        canvasRef={eng.canvasRef}
        error={eng.error}
        fps={eng.fps}
        res={eng.res}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onShowHelp={() => setShowHelp(true)}
        onShowAdvanced={() => setShowAdvanced(true)}
      />
      {fullscreen ? null : (
        <div className={styles.panel}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>Phosphene — NTSC signal path</h2>
            <a
              className={styles.link}
              href="https://github.com/cmdcolin/phosphene"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </div>

          <InputSection
            sourceMode={eng.sourceMode}
            onSelectSource={eng.selectSource}
            sourceBMode={eng.sourceBMode}
            onSelectSourceB={eng.selectSourceB}
            webcamDeviceId={eng.webcamDeviceId}
            videoDevices={eng.videoDevices}
            onStartWebcam={eng.startWebcam}
            fileInputRef={eng.fileInputRef}
            fileInputBRef={eng.fileInputBRef}
            onFile={eng.onFile}
            onFileB={eng.onFileB}
            renderGroup={renderGroup}
          />

          <PresetsSection
            controls={controls}
            lastPreset={lastPreset}
            onApplyPreset={applyPreset}
            comparing={comparing}
            onStartCompare={startCompare}
            onEndCompare={endCompare}
            onCopyLink={copyLink}
            copied={copied}
          />

          {/* MIDI only appears once enabled (from Advanced) — 99% of users never
              wire up a controller, so it stays out of the default panel. */}
          {midiStatus === 'ready' ? (
            <MidiSection
              armedKey={armedKey}
              midiBindings={midiBindings}
              bpm={bpm}
              onClearBinding={clearBinding}
              onClearAll={clearAll}
            />
          ) : null}

          {MAIN_GROUPS.map(group => renderGroup(group, false))}
        </div>
      )}
      {showAdvanced ? (
        <AdvancedDialog
          renderScale={eng.renderScale}
          onScaleChange={eng.setScale}
          res={eng.res}
          midiStatus={midiStatus}
          onEnableMidi={enableMidi}
          onClose={() => setShowAdvanced(false)}
        />
      ) : null}
      {eng.askWebcam ? (
        <WebcamDialog
          onContinue={() => eng.startWebcam('')}
          onClose={() => eng.setAskWebcam(false)}
        />
      ) : null}
      {showHelp ? <HelpDialog onClose={() => setShowHelp(false)} /> : null}
    </div>
  )
}

// The engine is a singleton owning a GPUDevice + rAF loop. Fast Refresh won't
// reliably run the mount effect's cleanup on a hot swap (an empty-dep effect
// isn't re-run), so old devices leak and stack up until Firefox Nightly's
// WebGPU hangs the tab. Destroy the engine deterministically before Vite
// replaces this module; the fresh module then builds a new one on remount.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.vf?.destroy()
    window.vf = undefined
  })
}
