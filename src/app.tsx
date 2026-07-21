import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_CONTROLS } from './controls'
import type { ControlKey, Controls } from './controls'
import { GROUPS, PHASES, type Group } from './ui/controls'
import { SYNCABLE_KEYS, SYNC_DIVISIONS, omit, syncedValue } from './ui/midi'
import {
  blendPresets,
  controlsEqual,
  matchPreset,
  presetControls,
  type PresetWeights,
} from './ui/presets'
import { mutate } from './ui/mutate'
import { useCapture } from './ui/useCapture'
import { cx } from './ui/cx'
import { Section } from './ui/Section'
import { Slider } from './ui/Slider'
import { Stage } from './ui/Stage'
import { FatalScreen } from './ui/FatalScreen'
import { HelpDialog } from './ui/HelpDialog'
import { WebcamDialog } from './ui/WebcamDialog'
import { YouTubeDialog } from './ui/YouTubeDialog'
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
import { useUrlState } from './ui/useUrlState'
import styles from './app.module.css'

// useSyncExternalStore fallbacks for the window before the async engine exists.
const subscribeNever = () => () => {}
const getDefaultControls = (): Controls => DEFAULT_CONTROLS

const AUDIO_GROUP = GROUPS.find(g => g.audio === true)
// The main groups arranged by signal-path phase — the spine the panel is
// browsed along. PHASES names the stages; resolve each to its group object.
const GROUP_BY_NAME = new Map(GROUPS.map(g => [g.name, g]))
const PHASED_GROUPS = PHASES.map(p => ({
  name: p.name,
  groups: p.groups.flatMap(n => {
    const g = GROUP_BY_NAME.get(n)
    return g === undefined ? [] : [g]
  }),
}))
// Every control that has a slider — the full set `mutate` jitters.
const ALL_SLIDERS = GROUPS.flatMap(g => g.sliders)
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
// Stable empty weights, so a stale mix passes the same map every render.
const NO_WEIGHTS: PresetWeights = new Map()
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

// Which signal-path stage is expanded. Persisted so a reload keeps your place.
const OPEN_GROUP_STORE = 'video_feedback_open_group'

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
  const [syncMap, setSyncMap] = useState<SyncMap>(loadSync)
  const [lastPreset, setLastPreset] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)
  const [filter, setFilter] = useState('')
  // Single-open browsing of the signal-path stages: only one stage's controls
  // expand at a time, so the phase map above them stays visible. null = the map
  // alone, which is where exploration starts.
  const [openGroup, setOpenGroup] = useState<string | null>(() =>
    localStorage.getItem(OPEN_GROUP_STORE),
  )
  const toggleGroup = (name: string) =>
    setOpenGroup(prev => {
      const next = prev === name ? null : name
      if (next === null) localStorage.removeItem(OPEN_GROUP_STORE)
      else localStorage.setItem(OPEN_GROUP_STORE, next)
      return next
    })
  const [scenes, setScenes] = useState<SceneMap>(loadScenes)
  // Single-level undo: the look from just before the last destructive apply
  // (preset, scene recall, or mutate), so a misclick is one keypress back.
  const [undoSnapshot, setUndoSnapshot] = useState<Controls | null>(null)
  // Preset mix: how much of each preset is dialed in, over the look that was
  // live when the mixing started. The engine still owns the controls — this is
  // the recipe that produced them, kept only so a weight can be dragged back.
  // Deliberately not persisted to scenes or the URL: those store the resolved
  // controls, which are version-stable, whereas a recipe binds to preset names
  // and patches that drift as presets are retuned. A recalled look can still be
  // re-mixed — startMix rebaselines from whatever is live.
  const [mix, setMix] = useState<{ base: Controls; weights: PresetWeights }>(
    () => ({ base: DEFAULT_CONTROLS, weights: new Map() }),
  )
  // The weights only describe the look while nothing else has moved it. Once a
  // randomize, slider, MIDI, mod, or scene recall changes the controls, "how
  // much of preset X is in this" is unrecoverable — blendPresets sums each
  // preset's departures, so many recipes land on the same look. So the fills
  // are shown only while the live controls still equal what the mix produced;
  // the instant anything diverges they read empty rather than lie, and the next
  // drag rebaselines onto whatever is live (startMix).
  const mixed = blendPresets(mix.base, mix.weights)
  const liveWeights = controlsEqual(controls, mixed) ? mix.weights : NO_WEIGHTS

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  // Capture the live look before overwriting it, so `undo` can restore it.
  const snapshotForUndo = () => {
    const cur = engineRef.current?.getControls()
    if (cur !== undefined) setUndoSnapshot(cur)
  }
  const undo = () => {
    if (undoSnapshot !== null) {
      writeControls(undoSnapshot)
      setUndoSnapshot(null)
    }
  }

  const applyPreset = (name: string, patch: Partial<Controls>) => {
    if (Object.keys(patch).length === 0) {
      // "clean" (the only empty patch) is the reset: wipe the mix to defaults.
      snapshotForUndo()
      writeControls(presetControls(patch))
      setMix({ base: DEFAULT_CONTROLS, weights: new Map() })
    } else {
      // Clicking tops the preset up to full without clearing partials already
      // dialed in — the same as dragging its slider to 100%. startMix (fired on
      // pointer down) has already rebaselined onto the live look and snapshotted
      // undo, so this only adds the weight.
      const weights = new Map(mix.weights).set(name, 1)
      writeControls(blendPresets(mix.base, weights))
      setMix({ base: mix.base, weights })
    }
    setLastPreset(name)
  }

  // Anything outside the mix — a slider, MIDI, a mod slot, a scene recall — can
  // have moved the controls since the last weight change. Whatever is live
  // becomes the new baseline, so the next drag layers onto it instead of
  // silently reverting it.
  const startMix = () => {
    const cur = engineRef.current?.getControls()
    if (cur !== undefined) {
      if (!controlsEqual(cur, mixed)) {
        setMix({ base: cur, weights: new Map() })
      }
      setUndoSnapshot(cur)
    }
  }
  const setPresetWeight = (name: string, w: number) => {
    const weights = new Map(mix.weights).set(name, w)
    writeControls(blendPresets(mix.base, weights))
    setMix({ base: mix.base, weights })
    setLastPreset(name)
  }

  const mutateLook = () => {
    const cur = engineRef.current?.getControls()
    if (cur !== undefined) {
      setUndoSnapshot(cur)
      writeControls(mutate(cur, ALL_SLIDERS))
      setLastPreset(null)
    }
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
    if (scene !== undefined) {
      snapshotForUndo()
      writeControls(presetControls(scene))
    }
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

  // Name captures after the active preset (or the last one, edited), so a saved
  // file says what it is. matchPreset falls through to a plain label otherwise.
  const activePreset = matchPreset(controls)
  const captureName = activePreset ? activePreset.name : (lastPreset ?? 'edit')
  const capture = useCapture(eng.canvasRef, captureName)

  // The keydown listener is mount-anchored (below) and must not re-subscribe on
  // every render, so it reads the latest action closures through this ref.
  const actionsRef = useRef({ capture, undo, undoSnapshot })
  actionsRef.current = { capture, undo, undoSnapshot }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTextEntry(e.target)
      const { capture, undo, undoSnapshot } = actionsRef.current
      if (e.key === 'Escape') {
        setShowAdvanced(false)
        setShowHelp(false)
        setFilter('')
        disarm()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (undoSnapshot !== null) {
          e.preventDefault()
          undo()
        }
      } else if (!typing && e.key === 'f') {
        toggleFullscreen()
      } else if (!typing && e.key === 'c' && !e.repeat) {
        startCompare()
      } else if (!typing && e.key === 'r' && !e.repeat) {
        capture.toggleRecord()
      } else if (!typing && e.key === 's' && !e.repeat) {
        capture.grabStill()
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
    // Lifecycle breadcrumbs: log every transition that could precede a freeze
    // BEFORE doing anything, so if the tab then locks up the last console line
    // names the trigger (tab hidden/shown, browser-frozen background tab, etc).
    const log = (m: string) => console.log(`[lifecycle] ${m}`)
    // Exiting fullscreen (and re-showing a hidden tab) can leave the browser
    // having stopped delivering rAF callbacks; re-arm the loop so the canvas
    // doesn't stay frozen. kick() is a no-op when the loop is already healthy.
    const onFs = () => {
      const fs = document.fullscreenElement !== null
      setFullscreen(fs)
      log(`fullscreen ${fs ? 'entered' : 'exited'}`)
      engineRef.current?.kick()
    }
    const onVisible = () => {
      log(`visibility -> ${document.visibilityState}`)
      if (document.visibilityState === 'visible') engineRef.current?.kick()
    }
    // Regaining focus (window un-occluded / re-selected) is a prime moment for
    // Firefox to resume a suspended refresh driver — nudge rAF right away.
    const onFocus = () => engineRef.current?.kick()
    // Page Lifecycle API: Firefox can freeze/discard a backgrounded tab; these
    // fire around that, and a `freeze` as the last line points straight at it.
    const onFreeze = () => log('freeze (tab suspended by browser)')
    const onResume = () => {
      log('resume (tab un-suspended)')
      engineRef.current?.kick()
    }
    const onPageHide = (e: PageTransitionEvent) =>
      log(`pagehide (persisted=${e.persisted})`)
    // Restored from bfcache: the GPUDevice captured before navigating away is
    // dead, so the canvas would render frozen. Reload to build a fresh engine.
    const onPageShow = (e: PageTransitionEvent) => {
      log(`pageshow (persisted=${e.persisted})`)
      if (e.persisted) location.reload()
    }
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('focus', onFocus)
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('visibilitychange', onVisible)
    document.addEventListener('freeze', onFreeze)
    document.addEventListener('resume', onResume)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('freeze', onFreeze)
      document.removeEventListener('resume', onResume)
    }
  }, [engineRef])

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

  const { copyLink, copied } = useUrlState({
    controls,
    engineReady: eng.engine !== null,
    sourceMode: eng.sourceMode,
    sourceBMode: eng.sourceBMode,
  })

  const audio = useAudio(eng.engine)

  const query = filter.trim().toLowerCase()
  const renderGroup = (
    group: Group,
    defaultOpen: boolean,
    control?: { open: boolean; onToggle: () => void },
  ) => {
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
        open={control?.open}
        onToggle={control?.onToggle}
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
            help={s.help}
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
        <h2 className={styles.title}>
          Phosphene
          <button
            className={styles.helpBtn}
            onClick={() => setShowHelp(true)}
            title="what is this?"
          >
            ?
          </button>
        </h2>
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
        sourceName={eng.sourceName}
        onSelectSource={eng.selectSource}
        sourceBMode={eng.sourceBMode}
        sourceBName={eng.sourceBName}
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
        weights={liveWeights}
        onApplyPreset={applyPreset}
        onMixStart={startMix}
        onMix={setPresetWeight}
        comparing={comparing}
        onStartCompare={startCompare}
        onEndCompare={endCompare}
        onCopyLink={copyLink}
        copied={copied}
        onMutate={mutateLook}
        canUndo={undoSnapshot !== null}
        onUndo={undo}
      />

      {/* The signal-path map is the panel's trunk, so it sits high — right under
          the source and preset front door — and the filter that acts on it heads
          it. Scenes/mod/audio/midi are occasional tools and drop below it. */}
      <input
        className={styles.filter}
        type="search"
        placeholder="filter controls…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      {PHASED_GROUPS.map(phase => {
        const rendered = phase.groups.map(group =>
          renderGroup(group, false, {
            open: openGroup === group.name,
            onToggle: () => toggleGroup(group.name),
          }),
        )
        return rendered.every(r => r === null) ? null : (
          <div key={phase.name}>
            <div className={styles.phaseLabel}>{phase.name}</div>
            {rendered}
          </div>
        )
      })}

      <ScenesSection
        controls={controls}
        scenes={scenes}
        onSave={saveScene}
        onRecall={recallScene}
        onClear={clearScene}
      />

      <ModSection engine={eng.engine} />

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
        recording={capture.recording}
        onToggleRecord={capture.toggleRecord}
        onGrabStill={capture.grabStill}
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
      {eng.askYouTube !== null ? (
        <YouTubeDialog
          slot={eng.askYouTube}
          onSubmit={url => {
            if (eng.askYouTube === 'b') eng.loadYouTubeB(url)
            else eng.loadYouTube(url)
            eng.setAskYouTube(null)
          }}
          onClose={() => eng.setAskYouTube(null)}
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
