import type { Controls } from '../gpu/pipeline'
import styles from '../app.module.css'
import { cx } from './cx'
import { Section } from './Section'
import { matchPreset, PRESETS } from './presets'

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

export function PresetsSection(props: {
  controls: Controls
  lastPreset: string | null
  onApplyPreset: (name: string, patch: Partial<Controls>) => void
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
          {grp.defs.map(p => {
            const isActive = active?.name === p.name
            const isEdited = active === undefined && props.lastPreset === p.name
            return (
              <button
                key={p.name}
                title={p.blurb}
                className={cx(
                  styles.btn,
                  isActive && styles.active,
                  isEdited && styles.edited,
                )}
                onClick={() => props.onApplyPreset(p.name, p.patch)}
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
        “clean” resets everything · hold C to compare · f for fullscreen
      </div>
    </Section>
  )
}
