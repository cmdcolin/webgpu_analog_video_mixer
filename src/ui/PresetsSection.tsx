import type { Controls } from '../controls'
import styles from '../app.module.css'
import { cx } from './cx'
import { Section } from './Section'
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

// Each preset is an apply button plus its own weight slider: click the name for
// the look outright, drag the slider to mix that preset into the current look.
// The slider reads empty whenever the live look no longer matches the mix (see
// liveWeights in app.tsx), so it never shows a level that isn't in effect.
function PresetRow(props: {
  def: PresetDef
  weight: number
  active: boolean
  edited: boolean
  onApply: (name: string, patch: Partial<Controls>) => void
  onMixStart: () => void
  onMix: (name: string, w: number) => void
}) {
  return (
    <div className={styles.presetRow}>
      <button
        title={props.def.blurb}
        className={cx(
          styles.btn,
          styles.presetApply,
          props.active && styles.active,
          props.edited && styles.edited,
        )}
        onClick={() => props.onApply(props.def.name, props.def.patch)}
      >
        {props.def.name}
        {props.edited ? ' •' : ''}
      </button>
      <input
        type="range"
        className={styles.presetWeight}
        min={0}
        max={1}
        step={0.01}
        value={props.weight}
        aria-label={`mix in ${props.def.name}`}
        title={`drag to mix ${props.def.name} into the current look`}
        // Rebaseline onto the live look before the first change, on pointer or
        // keyboard, so the mix layers on instead of reverting whatever is live.
        onPointerDown={props.onMixStart}
        onKeyDown={props.onMixStart}
        onChange={e => props.onMix(props.def.name, e.currentTarget.valueAsNumber)}
      />
    </div>
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
  const active = matchPreset(props.controls)
  const presetCaption = active
    ? active.blurb
    : props.lastPreset === null
      ? 'click a preset for an instant look, then tweak the sliders below.'
      : `modified from "${props.lastPreset}"`

  return (
    <Section title="Presets">
      {PRESET_GROUPS.map(grp => (
        <div key={grp.name} style={{ margin: '2px 0 4px' }}>
          <div className={styles.grpLabel}>{grp.name}</div>
          {grp.defs.map(p => (
            <PresetRow
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
      <div className={styles.hint}>
        click a preset for its look, or drag its slider to mix it in · “clean”
        resets everything · hold C to compare · f for fullscreen
      </div>
    </Section>
  )
}
