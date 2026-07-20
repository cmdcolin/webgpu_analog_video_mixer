import { cx } from './cx'
import styles from './Slider.module.css'

export function Slider(props: {
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
}) {
  const midi = props.midi
  const sync = props.sync
  const locked = sync?.label !== null && sync?.live === true
  return (
    <label className={styles.slider}>
      <span className={styles.sliderTop}>
        <span>{props.label}</span>
        <span className={styles.value}>
          {props.value.toFixed(props.step < 0.01 ? 3 : props.step < 1 ? 2 : 0)}
          {props.unit}
          {sync ? (
            <button
              title={
                sync.label === null
                  ? 'lock to MIDI clock'
                  : `clock-synced (${sync.label}) — click to change`
              }
              className={cx(
                styles.icon,
                sync.label !== null &&
                  (sync.live ? styles.iconOn : styles.iconSyncSet),
              )}
              onClick={e => {
                e.preventDefault()
                sync.onCycle()
              }}
            >
              {sync.label === null ? '♩' : `♩${sync.label}`}
            </button>
          ) : null}
          {midi ? (
            <button
              title={
                midi.label === null
                  ? 'assign a MIDI control'
                  : `MIDI CC${midi.label} — click to relearn`
              }
              className={cx(
                styles.icon,
                midi.armed
                  ? styles.iconOn
                  : midi.label !== null && styles.iconMidiSet,
              )}
              onClick={e => {
                e.preventDefault()
                midi.onArm()
              }}
            >
              {midi.armed
                ? 'learn…'
                : midi.label === null
                  ? '⚟'
                  : `CC${midi.label}`}
            </button>
          ) : null}
          <button
            title="reset"
            className={cx(
              styles.reset,
              props.value === props.defaultValue && styles.resetDef,
            )}
            onClick={e => {
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
        onChange={e => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}
