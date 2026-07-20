import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_CONTROLS } from './gpu/pipeline'
import type { ControlKey, Controls } from './gpu/pipeline'
import { GROUPS, type Group } from './ui/controls'
import { SYNCABLE_KEYS, SYNC_DIVISIONS, omit, syncedValue } from './ui/midi'
import { presetControls } from './ui/presets'
import { cx } from './ui/cx'
import { Section } from './ui/Section'
import { Slider } from './ui/Slider'
import { Stage } from './ui/Stage'
import { FatalScreen } from './ui/FatalScreen'
import { HelpDialog } from './ui/HelpDialog'
import { WebcamDialog } from './ui/WebcamDialog'
import { AdvancedDialog } from './ui/AdvancedDialog'
import { InputSection } from './ui/InputSection'
import { PresetsSection } from './ui/PresetsSection'
import { ScenesSection } from './ui/ScenesSection'
import { ModSection } from './ui/ModSection'
import { MidiSection } from './ui/MidiSection'
import { AudioSection } from './ui/AudioSection'
import { useAudio } from './ui/useAudio'
import { useEngine } from './ui/useEngine'
import { useMidi } from './ui/useMidi'
import { usePopout } from './ui/usePopout'
import styles from './app.module.css'

// useSyncExternalStore fallbacks for the window before the async engine exists.
const subscribeNever = () => () => {}
const getDefaultControls = (): Controls => DEFAULT_CONTROLS

const MAIN_GROUPS = GROUPS.filter(g => g.ab !== true && g.audio !== true)
const AUDIO_GROUP = GROUPS.find(g => g.audio === true)
const SYNCABLE_SET = new Set<ControlKey>(SYNCABLE_KEYS)

// Which rate controls are clock-locked, and to which SYNC_DIVISIONS index.
type SyncMap = Partial<Record<ControlKey, number>>
const SYNC_STORE = 'video_feedback_midi_sync'
function loadSync(): SyncMap {
  const raw = localStorage.getItem(SYNC_STORE)
  return raw === null ? {} : (JSON.parse(raw) as SyncMap)
}

// Numbered performance snapshots (slots 1–9). localStorage is the source of
// truth so the mount-anchored key handlers never work from stale React state.
type SceneMap = Partial<Record<string, Partial<Controls>>>
const SCENES_STORE = 'video_feedback_scenes'
function loadScenes(): SceneMap {
  const raw = localStorage.getItem(SCENES_STORE)
  return raw === null ? {} : (JSON.parse(raw) as SceneMap)
}

// The panel can live in the popout window, whose elements belong to a foreign
// realm — `instanceof HTMLInputElement` is always false there — so sniff the
// shape instead. Range sliders don't count: they should not swallow shortcuts.
function isTextEntry(t: EventTarget | null): boolean {
  return (
    t !== null &&
    'tagName' in t &&
    t.tagName === 'INPUT' &&
    'type' in t &&
    t.type !== 'range'
  )
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
  const { popout, openPopout } = usePopout()
  const [fullscreen, setFullscreen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [syncMap, setSyncMap] = useState<SyncMap>(loadSync)
  const [lastPreset, setLastPreset] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)
  const [filter, setFilter] = useState('')
  const [scenes, setScenes] = useState<SceneMap>(loadScenes)

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

  const persistScenes = (next: SceneMap) => {
    localStorage.setItem(SCENES_STORE, JSON.stringify(next))
    setScenes(next)
  }
  const saveScene = (n: number) => {
    const cur = engineRef.current?.getControls()
    if (cur !== undefined) persistScenes({ ...loadScenes(), [n]: cur })
  }
  const recallScene = (n: number) => {
    const scene = loadScenes()[n]
    if (scene !== undefined) writeControls(presetControls(scene))
  }
  const clearScene = (n: number) => {
    persistScenes(
      Object.fromEntries(
        Object.entries(loadScenes()).filter(([k]) => k !== String(n)),
      ),
    )
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
      const typing = isTextEntry(e.target)
      if (e.key === 'Escape') {
        setShowAdvanced(false)
        setShowHelp(false)
        setFilter('')
        disarm()
      } else if (!typing && e.key === 'f') {
        toggleFullscreen()
      } else if (!typing && e.key === 'c' && !e.repeat) {
        startCompare()
      } else if (!typing) {
        const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
        if (m !== null && !e.repeat) {
          if (e.shiftKey) saveScene(Number(m[1]))
          else recallScene(Number(m[1]))
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'c') endCompare()
    }
    // Shortcuts work wherever the panel lives: main window and the popout.
    const targets = popout === null ? [window] : [window, popout]
    for (const t of targets) {
      t.addEventListener('keydown', onKey)
      t.addEventListener('keyup', onKeyUp)
    }
    return () => {
      for (const t of targets) {
        t.removeEventListener('keydown', onKey)
        t.removeEventListener('keyup', onKeyUp)
      }
    }
    // Handlers act through stable refs/setters (and localStorage for scenes);
    // only the popout window appearing or going away changes the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popout])

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement !== null)
    // Restored from bfcache: the GPUDevice captured before navigating away is
    // dead, so the canvas would render frozen. Reload to build a fresh engine.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) location.reload()
    }
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('fullscreenchange', onFs)
    }
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

  const audio = useAudio(eng.engine)

  const query = filter.trim().toLowerCase()
  const renderGroup = (group: Group, defaultOpen: boolean) => {
    const sliders =
      query === '' || group.name.toLowerCase().includes(query)
        ? group.sliders
        : group.sliders.filter(s => s.label.toLowerCase().includes(query))
    const touched = group.sliders.some(
      s => controls[s.key] !== DEFAULT_CONTROLS[s.key],
    )
    return sliders.length === 0 ? null : (
      <Section
        key={group.name}
        title={group.name}
        defaultOpen={defaultOpen}
        forceOpen={query !== ''}
        dot={touched}
      >
        {sliders.map(s => (
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
  }

  const panelBody = (
    <>
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

      <ScenesSection
        controls={controls}
        scenes={scenes}
        onSave={saveScene}
        onRecall={recallScene}
        onClear={clearScene}
      />

      <ModSection engine={eng.engine} />

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

      <input
        className={styles.filter}
        type="search"
        placeholder="filter controls…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      {AUDIO_GROUP === undefined ? null : (
        <AudioSection
          active={audio.active}
          level={audio.level}
          hit={audio.hit}
          error={audio.error}
          onEnableMic={audio.enableMic}
          onDisable={audio.disable}
          group={AUDIO_GROUP}
          renderGroup={renderGroup}
        />
      )}
      {MAIN_GROUPS.map(group => renderGroup(group, false))}
    </>
  )

  return eng.fatal !== null ? (
    <FatalScreen fatal={eng.fatal} />
  ) : (
    <div className={styles.app}>
      <Stage
        canvasRef={eng.canvasRef}
        error={eng.error}
        stats={eng.stats}
        res={eng.res}
        fullscreen={fullscreen}
        poppedOut={popout !== null}
        onToggleFullscreen={toggleFullscreen}
        onPopout={openPopout}
        onShowHelp={() => setShowHelp(true)}
        onShowAdvanced={() => setShowAdvanced(true)}
      />
      {fullscreen || popout !== null ? null : (
        <div className={styles.panel}>{panelBody}</div>
      )}
      {popout === null
        ? null
        : createPortal(
            <div className={styles.app}>
              <div className={cx(styles.panel, styles.panelPop)}>
                {panelBody}
              </div>
            </div>,
            popout.document.body,
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
