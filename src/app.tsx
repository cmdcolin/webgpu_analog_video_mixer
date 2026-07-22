import { useState, useSyncExternalStore } from 'react'

import { createPortal } from 'react-dom'

import styles from './app.module.css'
import { DEFAULT_CONTROLS } from './controls'
import { AdvancedDialog } from './ui/AdvancedDialog'
import { AudioSection } from './ui/AudioSection'
import { FatalScreen } from './ui/FatalScreen'
import { HelpDialog } from './ui/HelpDialog'
import { InputSection } from './ui/InputSection'
import { MidiSection } from './ui/MidiSection'
import { ModSection } from './ui/ModSection'
import { PipFrame } from './ui/PipFrame'
import { PresetsSection } from './ui/PresetsSection'
import { ScenesSection } from './ui/ScenesSection'
import { Section } from './ui/Section'
import { Slider } from './ui/Slider'
import { Stage } from './ui/Stage'
import { VaporwaveSection } from './ui/VaporwaveSection'
import { WebcamDialog } from './ui/WebcamDialog'
import { WipeFrame } from './ui/WipeFrame'
import { YouTubeDialog } from './ui/YouTubeDialog'
import { GROUPS, NEEDS, PHASES, SLIDER_BY_KEY } from './ui/controls'
import { cx } from './ui/cx'
import { SYNCABLE_KEYS } from './ui/midi'
import { mutate } from './ui/mutate'
import {
  PRESETS,
  blendPresets,
  controlsEqual,
  matchPreset,
  presetControls,
} from './ui/presets'
import { useAudio } from './ui/useAudio'
import { useCapture } from './ui/useCapture'
import { useClockSync } from './ui/useClockSync'
import { useEngine } from './ui/useEngine'
import { useFavorites } from './ui/useFavorites'
import { useMidi } from './ui/useMidi'
import { usePageLifecycle } from './ui/usePageLifecycle'
import { usePopout } from './ui/usePopout'
import { useScenes } from './ui/useScenes'
import { useShortcuts } from './ui/useShortcuts'
import { useUrlState } from './ui/useUrlState'
import { gitSha, versionLabel } from './version'

import type { ControlKey, Controls } from './controls'
import type { Group, SliderDef, SliderNeed } from './ui/controls'
import type { PresetWeights } from './ui/presets'

// useSyncExternalStore fallbacks for the window before the async engine exists.
const subscribeNever = () => () => {}
const getDefaultControls = (): Controls => DEFAULT_CONTROLS

const AUDIO_GROUP = GROUPS.find(g => g.place === 'audio')
// A/B mix groups get their own section below Input when source B is on, rather
// than swelling the Input row in place (which shoves the presets down the panel
// and reads as if their order changed).
const AB_GROUPS = GROUPS.filter(g => g.place === 'ab')
// Every control that has a slider — the full set `mutate` jitters.
const ALL_SLIDERS = GROUPS.flatMap(g => g.sliders)
const SYNCABLE_SET = new Set<ControlKey>(SYNCABLE_KEYS)

// Stable empty weights, so a stale mix passes the same map every render.
const NO_WEIGHTS: PresetWeights = new Map()

// The inset geometry is dragged on a miniature of the picture instead of read
// off four sliders; the sliders stay reachable through the filter box.
const PIP_GROUP = 'PiP inset (source B)'
const PIP_BOX_KEYS = new Set<ControlKey>(['pipX', 'pipY', 'pipW', 'pipH'])
const WIPE_GROUP = 'Wipe (A/B)'

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
    autoMap,
    learn,
    learnSequence,
    stopLearn,
    clearBinding,
    clearAll,
  } = useMidi(engineRef)
  // The engine IS the store: React reads controls straight from it via
  // useSyncExternalStore, so there's no separate `values` copy to keep in sync.
  const controls = useSyncExternalStore(
    eng.engine === null ? subscribeNever : eng.engine.subscribeControls,
    eng.engine === null ? getDefaultControls : eng.engine.getControls,
  )
  const { cycleSync, syncLabel, displayValue } = useClockSync({
    controls,
    bpm,
    writeControl,
  })
  const { popout, openPopout } = usePopout()
  const [fullscreen, setFullscreen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
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
  const openGroupByName = (name: string) => {
    localStorage.setItem(OPEN_GROUP_STORE, name)
    setOpenGroup(name)
  }
  const { favorites, toggleFavorite } = useFavorites()
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
  const { scenes, saveScene, recallScene, clearScene } = useScenes(
    engineRef,
    writeControls,
    snapshotForUndo,
  )

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

  // A fresh look from the authored presets: one full preset plus one or two
  // partial ones from other groups, over clean defaults. Built through the mix
  // machinery so the chips show the recipe — each roll teaches what made it.
  const surprise = () => {
    const cur = engineRef.current?.getControls()
    if (cur === undefined) {
      return
    }
    setUndoSnapshot(cur)
    const pool = PRESETS.filter(
      p =>
        p.group !== 'Clean' &&
        (eng.sourceBMode !== 'none' || p.group !== 'A/B mixing'),
    )
    const groups = [...new Set(pool.map(p => p.group))].sort(
      () => Math.random() - 0.5,
    )
    const weights = new Map<string, number>()
    groups.slice(0, 2 + Math.floor(Math.random() * 2)).forEach((g, i) => {
      const opts = pool.filter(p => p.group === g)
      const p = opts[Math.floor(Math.random() * opts.length)]
      weights.set(p.name, i === 0 ? 1 : 0.3 + Math.random() * 0.5)
    })
    writeControls(blendPresets(DEFAULT_CONTROLS, weights))
    setMix({ base: DEFAULT_CONTROLS, weights })
    setLastPreset(null)
  }

  const mutateLook = () => {
    const cur = engineRef.current?.getControls()
    if (cur !== undefined) {
      setUndoSnapshot(cur)
      writeControls(mutate(cur, ALL_SLIDERS))
      setLastPreset(null)
    }
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

  useShortcuts(popout, {
    // Dialogs close themselves (each Dialog binds Escape to its own document);
    // here Escape just backs out of the panel's own modes.
    onEscape: () => {
      setFilter('')
      disarm()
      stopLearn()
    },
    onUndo: undo,
    canUndo: undoSnapshot !== null,
    onToggleFullscreen: toggleFullscreen,
    onStartCompare: startCompare,
    onEndCompare: endCompare,
    onToggleRecord: capture.toggleRecord,
    onGrabStill: capture.grabStill,
    onSaveScene: saveScene,
    onRecallScene: recallScene,
  })
  usePageLifecycle(engineRef, setFullscreen)

  const bindLabel = (key: ControlKey): string | null => {
    const b = midiBindings[key]
    return b === undefined ? null : String(b.controller)
  }

  const { copyLink, copied } = useUrlState({
    controls,
    engineReady: eng.engine !== null,
    sourceMode: eng.sourceMode,
    sourceBMode: eng.sourceBMode,
    ytUrlA: eng.ytUrlA,
    ytUrlB: eng.ytUrlB,
    speedA: eng.speedA,
    speedB: eng.speedB,
    reverb: eng.reverb,
  })

  const audio = useAudio(eng.engine)

  const query = filter.trim().toLowerCase()
  const renderNeeds = (s: SliderDef, muted?: Set<ControlKey>) => {
    const need = NEEDS[s.key]
    if (
      need === undefined ||
      need.ok(controls[need.key]) ||
      muted?.has(need.key) === true
    ) {
      return undefined
    }
    const prereq = SLIDER_BY_KEY.get(need.key)
    return {
      hint: need.hint,
      title: `does nothing until "${prereq?.label ?? need.key}" moves — click to set it to ${need.fix}${prereq?.unit ?? ''}`,
      onFix: () => writeControl(need.key, need.fix),
    }
  }
  const renderSlider = (s: SliderDef, mutedNeeds?: Set<ControlKey>) => (
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
      choices={s.choices}
      help={s.help}
      needs={renderNeeds(s, mutedNeeds)}
      favorite={{
        on: favorites.has(s.key),
        onToggle: () => toggleFavorite(s.key),
      }}
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
  )
  const renderGroup = (
    group: Group,
    defaultOpen: boolean,
    control?: { open: boolean; onToggle: () => void },
  ) => {
    // Match help text too, not just labels: users hunt by artifact ("rainbow",
    // "ghost", "comb"), and the mechanism prose is where those words live.
    const matched =
      query === '' || group.name.toLowerCase().includes(query)
        ? group.sliders
        : group.sliders.filter(
            s =>
              s.label.toLowerCase().includes(query) ||
              s.help.toLowerCase().includes(query),
          )
    // The miniatures replace the geometry sliders they duplicate; typing in
    // the filter box brings those sliders back, MIDI and clock icons included.
    const pipFrame = group.name === PIP_GROUP && query === ''
    const wipeFrame = group.name === WIPE_GROUP && query === ''
    const sliders = pipFrame
      ? matched.filter(s => !PIP_BOX_KEYS.has(s.key))
      : wipeFrame
        ? matched.filter(s => s.key !== 'wipePos')
        : matched
    const touched = group.sliders.some(
      s => controls[s.key] !== DEFAULT_CONTROLS[s.key],
    )
    // When most of a group is dead behind the same gate (e.g. all of Mixer
    // Loop behind loop mix), one banner beats a stack of identical per-slider
    // notes; the notes stay only for the odd ones out.
    const unmetCounts = new Map<ControlKey, { need: SliderNeed; n: number }>()
    for (const s of sliders) {
      const need = NEEDS[s.key]
      if (need !== undefined && !need.ok(controls[need.key])) {
        const e = unmetCounts.get(need.key)
        if (e === undefined) unmetCounts.set(need.key, { need, n: 1 })
        else e.n += 1
      }
    }
    const banners = [...unmetCounts.values()].filter(e => e.n >= 3)
    const mutedNeeds = new Set(banners.map(e => e.need.key))
    return sliders.length === 0 && !pipFrame && !wipeFrame ? null : (
      <Section
        key={group.name}
        title={group.name}
        defaultOpen={defaultOpen}
        forceOpen={query !== ''}
        dot={touched}
        open={control?.open}
        onToggle={control?.onToggle}
      >
        {wipeFrame ? (
          <WipeFrame
            mode={controls.wipeMode}
            pos={controls.wipePos}
            inert={controls.wipeMode < 1}
            onChange={pos => writeControl('wipePos', pos)}
          />
        ) : null}
        {pipFrame ? (
          <PipFrame
            inert={controls.pipMix === 0}
            box={{
              x: controls.pipX,
              y: controls.pipY,
              w: controls.pipW,
              h: controls.pipH,
            }}
            onChange={box => {
              writeControl('pipX', box.x)
              writeControl('pipY', box.y)
              writeControl('pipW', box.w)
              writeControl('pipH', box.h)
            }}
          />
        ) : null}
        {banners.map(({ need, n }) => (
          <button
            key={need.key}
            className={styles.groupNeeds}
            title={`click to set "${SLIDER_BY_KEY.get(need.key)?.label ?? need.key}" to ${need.fix}${SLIDER_BY_KEY.get(need.key)?.unit ?? ''}`}
            onClick={() => writeControl(need.key, need.fix)}
          >
            {n} controls here are inert — needs {need.hint} · click to set
          </button>
        ))}
        {sliders.map(s => renderSlider(s, mutedNeeds))}
      </Section>
    )
  }

  const phaseEls = PHASES.map(phase => {
    const rendered = phase.groups.map(group =>
      renderGroup(group, false, {
        open: openGroup === group.name,
        onToggle: () => toggleGroup(group.name),
      }),
    )
    // Roll the per-group touched state up to the phase, so the collapsed
    // spine reads as a status map — you see which phases you're in without
    // opening any. The count is a button: it jumps you into the first touched
    // group, which is the path from "this preset looks cool" to the knobs
    // that made it.
    const touchedGroups = phase.groups.filter(g =>
      g.sliders.some(s => controls[s.key] !== DEFAULT_CONTROLS[s.key]),
    )
    const nTouched = touchedGroups.reduce(
      (n, g) =>
        n +
        g.sliders.filter(s => controls[s.key] !== DEFAULT_CONTROLS[s.key])
          .length,
      0,
    )
    return rendered.every(r => r === null) ? null : (
      <div key={phase.name}>
        <div className={styles.phaseLabel} title={phase.blurb}>
          {phase.name}
          {touchedGroups.length === 0 ? null : (
            <button
              className={styles.phaseDot}
              title={`${nTouched} control${nTouched === 1 ? '' : 's'} in this stage off stock — click to see`}
              onClick={() => openGroupByName(touchedGroups[0].name)}
            >
              • {nTouched}
            </button>
          )}
        </div>
        {rendered}
      </div>
    )
  })

  const panelBody = (
    <>
      <div className={styles.titleRow}>
        <button
          className={styles.brand}
          onClick={() => setShowHelp(true)}
          title={`Phosphene ${versionLabel} (${gitSha}) — what is this?`}
          aria-label="Phosphene — what is this?"
        >
          <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true">
            <defs>
              <clipPath id="brandBars">
                <rect width="26" height="18" rx="3" />
              </clipPath>
            </defs>
            <g clipPath="url(#brandBars)">
              <rect x="0" width="3.714" height="18" fill="#bfbfbf" />
              <rect x="3.714" width="3.714" height="18" fill="#bfbf00" />
              <rect x="7.429" width="3.714" height="18" fill="#00bfbf" />
              <rect x="11.143" width="3.714" height="18" fill="#00bf00" />
              <rect x="14.857" width="3.714" height="18" fill="#bf00bf" />
              <rect x="18.571" width="3.714" height="18" fill="#bf0000" />
              <rect x="22.286" width="3.714" height="18" fill="#0000bf" />
            </g>
          </svg>
          <span className={styles.wordmark}>PHOSPHENE</span>
          <span className={styles.version}>{versionLabel}</span>
        </button>
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
      />

      {eng.sourceBMode === 'none' ? null : (
        <Section title="A/B Mix" defaultOpen>
          {/* Primary mixer open, alternative compositors (wipe, PiP) collapsed,
              so enabling B surfaces the mix controls without unfurling every
              slider at once. */}
          {AB_GROUPS.map((group, i) => renderGroup(group, i === 0))}
        </Section>
      )}

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
        onSurprise={surprise}
        canUndo={undoSnapshot !== null}
        onUndo={undo}
      />

      {/* Pinned controls, gathered from wherever they live in the chain into one
          spot near the front door. Shown only once something is starred, so it
          costs nothing until used; ordered by the signal path, not pin order, so
          the set stays stable as pins come and go. */}
      {favorites.size === 0 ? null : (
        <Section title="Favorites" defaultOpen>
          {ALL_SLIDERS.filter(s => favorites.has(s.key)).map(s =>
            renderSlider(s),
          )}
        </Section>
      )}

      {/* The signal-path map is the panel's trunk, so it sits high — right under
          the source and preset front door — and the filter that acts on it heads
          it. Scenes/mod/audio/midi are occasional tools and drop below it. */}
      <input
        className={styles.filter}
        type="search"
        placeholder="filter controls — try “rainbow” or “ghost”…"
        title="matches names and descriptions, so artifact words work: rainbow, ghost, dot crawl, tear, roll…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      <div className={styles.hint}>
        the signal path, in order — hover a stage name for its role
      </div>
      {phaseEls}
      {query === '' || phaseEls.some(el => el !== null) ? null : (
        <div className={styles.hint}>
          nothing matches “{filter.trim()}” — descriptions are searched too, so
          artifact words like “rainbow”, “ghost”, or “tear” find the sliders
          that cause them
        </div>
      )}

      <ScenesSection
        controls={controls}
        scenes={scenes}
        onSave={saveScene}
        onRecall={recallScene}
        onClear={clearScene}
      />

      <ModSection engine={eng.engine} />

      {eng.videoA || eng.videoB ? (
        <VaporwaveSection
          videoA={eng.videoA}
          videoB={eng.videoB}
          speedA={eng.speedA}
          speedB={eng.speedB}
          reverb={eng.reverb}
          playAudio={eng.playAudio}
          level={eng.audioLevel}
          onSpeedA={eng.changeSpeedA}
          onSpeedB={eng.changeSpeedB}
          onReverb={eng.changeReverb}
          onTogglePlayAudio={eng.toggleAudio}
          onApplyPreset={eng.applyVaporwave}
        />
      ) : null}

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
          learn={learn}
          midiBindings={midiBindings}
          bpm={bpm}
          onAutoMap={autoMap}
          onLearnSequence={learnSequence}
          onStopLearn={stopLearn}
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
          engine={eng.engine}
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
