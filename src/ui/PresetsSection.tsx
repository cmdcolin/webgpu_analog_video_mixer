import { useRef, useState, type CSSProperties } from 'react'
import type { Controls } from '../controls'
import styles from '../app.module.css'
import { cx } from './cx'
import { Dialog } from './Dialog'
import { BulbIcon } from './icons'
import { Section } from './Section'
import { usePersistedFlag } from './storage'
import {
  matchPreset,
  PRESETS,
  type PresetDef,
  type PresetWeights,
} from './presets'

// Presets grouped under their labeled headers. Derived purely from the static
// PRESETS table, so it's computed once at module load, not every render.
const PRESET_GROUPS = PRESETS.reduce<{ name: string; defs: typeof PRESETS }[]>(
  (acc, p) => {
    const g = acc.find(x => x.name === p.group)
    if (g === undefined) acc.push({ name: p.group, defs: [p] })
    else g.defs.push(p)
    return acc
  },
  [],
)

// Click applies the preset outright; dragging sideways past a few pixels turns
// the button into a weight slider, mixing that preset onto the current look.
const DRAG_SLOP = 4

// The preset gesture hint is shown until the user dismisses it with its ×;
// that choice persists, so it teaches once and then stops costing a row.
const HINT_STORE = 'video_feedback_preset_hint_dismissed'

// The one explainer for the whole feature (behind the ? by the section title),
// so the compact chips carry no per-preset help of their own — each chip's blurb
// stays on hover.
function PresetsHelpDialog(props: { onClose: () => void }) {
  return (
    <Dialog title="Presets" onClose={props.onClose}>
      <p className={styles.helpText}>
        Each preset is a named look — a bundle of control settings that recreates
        a particular signal fault or device. Hover one for what it does.
      </p>
      <p className={styles.helpText}>
        Every preset is also a fader: click to dial it fully in, or drag sideways
        for a partial amount. Either way it layers onto what’s already there
        rather than replacing it, and the fill shows how much is in — so stacking
        several accumulates their faults. “clean” clears them all.
      </p>
      <div className={styles.muted}>
        A mix lasts only until something else moves the look — a slider, mutate, a
        scene — and then the fills reset, since a blended look can’t be traced
        back to exact amounts.
      </div>
    </Dialog>
  )
}

function PresetButton(props: {
  def: PresetDef
  weight: number
  active: boolean
  edited: boolean
  onApply: (name: string, patch: Partial<Controls>) => void
  onMixStart: () => void
  onMix: (name: string, w: number) => void
}) {
  // Gesture bookkeeping only — nothing here should cause a render.
  const dragRef = useRef<{ startX: number; moved: boolean } | null>(null)
  const fill: CSSProperties & Record<'--w', string> = {
    '--w': `${Math.round(props.weight * 100)}%`,
  }
  return (
    <button
      title={`${props.def.blurb} — drag sideways to mix it in partially`}
      style={fill}
      className={cx(
        styles.btn,
        styles.presetBtn,
        props.active && styles.active,
        props.edited && styles.edited,
      )}
      onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { startX: e.clientX, moved: false }
        props.onMixStart()
      }}
      onPointerMove={e => {
        const d = dragRef.current
        if (
          d !== null &&
          (d.moved || Math.abs(e.clientX - d.startX) > DRAG_SLOP)
        ) {
          d.moved = true
          const r = e.currentTarget.getBoundingClientRect()
          const x = (e.clientX - r.left) / r.width
          props.onMix(props.def.name, Math.max(0, Math.min(1, x)))
        }
      }}
      onPointerUp={() => {
        const d = dragRef.current
        dragRef.current = null
        if (d !== null && !d.moved)
          props.onApply(props.def.name, props.def.patch)
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
    >
      {props.def.name}
      {props.edited ? ' •' : ''}
    </button>
  )
}

export function PresetsSection(props: {
  controls: Controls
  lastPreset: string | null
  weights: PresetWeights
  onApplyPreset: (name: string, patch: Partial<Controls>) => void
  onMixStart: () => void
  onMix: (name: string, w: number) => void
  comparing: boolean
  onStartCompare: () => void
  onEndCompare: () => void
  onCopyLink: () => void
  copied: boolean
  onMutate: () => void
  canUndo: boolean
  onUndo: () => void
}) {
  const [showHelp, setShowHelp] = useState(false)
  const [hintDismissed, setHintDismissed] = usePersistedFlag(HINT_STORE)
  const active = matchPreset(props.controls)
  const presetCaption = active
    ? active.blurb
    : props.lastPreset === null
      ? 'click a preset for an instant look, then tweak the sliders below.'
      : `modified from "${props.lastPreset}"`

  return (
    <Section
      title="Presets"
      help={
        <button
          className={styles.helpBtn}
          style={{ marginLeft: 6 }}
          title="what are presets?"
          onClick={e => {
            e.stopPropagation()
            setShowHelp(true)
          }}
        >
          ?
        </button>
      }
    >
      {hintDismissed ? null : (
        <div className={cx(styles.hint, styles.dismissHint)}>
          <span className={styles.hintIcon}>
            <BulbIcon />
          </span>
          <span>
            click and drag on buttons to partially apply · “clean” resets
            everything · hold C to compare · f for fullscreen
          </span>
          <button
            className={styles.hintX}
            title="dismiss this hint"
            aria-label="dismiss hint"
            onClick={() => setHintDismissed(true)}
          >
            ×
          </button>
        </div>
      )}
      {PRESET_GROUPS.map(grp => (
        <div key={grp.name} style={{ margin: '2px 0 4px' }}>
          <div className={styles.grpLabel}>{grp.name}</div>
          {grp.defs.map(p => (
            <PresetButton
              key={p.name}
              def={p}
              weight={props.weights.get(p.name) ?? 0}
              active={active?.name === p.name}
              edited={active === undefined && props.lastPreset === p.name}
              onApply={props.onApplyPreset}
              onMixStart={props.onMixStart}
              onMix={props.onMix}
            />
          ))}
        </div>
      ))}
      <div className={styles.caption}>{presetCaption}</div>
      <button
        onPointerDown={props.onStartCompare}
        onPointerUp={props.onEndCompare}
        onPointerLeave={props.onEndCompare}
        className={cx(styles.btn, props.comparing && styles.active)}
        title="hold to preview the clean signal, release to return (or hold C)"
      >
        {props.comparing ? 'showing clean…' : 'hold to compare'}
      </button>
      <button
        className={cx(styles.btn, props.copied && styles.active)}
        onClick={props.onCopyLink}
      >
        {props.copied ? 'copied!' : 'copy link'}
      </button>
      <button
        className={styles.btn}
        onClick={props.onMutate}
        title="jitter every control around the current look, for a related variation (also happy accidents)"
      >
        mutate
      </button>
      <button
        className={cx(styles.btn, !props.canUndo && styles.slotEmpty)}
        onClick={props.onUndo}
        disabled={!props.canUndo}
        title="restore the look from before the last preset, scene, or mutate"
      >
        undo
      </button>
      {showHelp ? (
        <PresetsHelpDialog onClose={() => setShowHelp(false)} />
      ) : null}
    </Section>
  )
}
