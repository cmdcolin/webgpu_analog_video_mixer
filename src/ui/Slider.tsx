import { useState, type CSSProperties } from 'react'
import { cx } from './cx'
import { formatValue } from './format'
import { SliderHelpDialog } from './SliderHelpDialog'
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
  help?: string
  midi?: { label: string | null; armed: boolean; onArm: () => void }
  sync?: { label: string | null; live: boolean; onCycle: () => void }
  favorite?: { on: boolean; onToggle: () => void }
}) {
  const [showHelp, setShowHelp] = useState(false)
  const midi = props.midi
  const sync = props.sync
  const help = props.help
  const favorite = props.favorite
  const locked = sync?.label !== null && sync?.live === true
  // Track fill anchors at the default, not the left edge: bipolar controls
  // read like a pan pot from center, and distance-from-stock shows at a glance.
  const pct = (v: number) =>
    Math.max(
      0,
      Math.min(100, ((v - props.min) / (props.max - props.min)) * 100),
    )
  const valuePct = pct(props.value)
  const defPct = pct(props.defaultValue)
  const fill: CSSProperties & Record<'--lo' | '--hi' | '--def', string> = {
    '--lo': `${Math.min(valuePct, defPct)}%`,
    '--hi': `${Math.max(valuePct, defPct)}%`,
    '--def': `${defPct}%`,
  }
  return (
    <div className={styles.slider}>
      <label>
        <span className={styles.sliderTop}>
          <span>
            {props.label}
            {help === undefined ? null : (
              <button
                title="what does this do?"
                className={styles.what}
                onClick={e => {
                  e.preventDefault()
                  setShowHelp(true)
                }}
              >
                ?
              </button>
            )}
          </span>
          <span className={styles.value}>
            {formatValue(props.value, props.step)}
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
            {favorite ? (
              <button
                title={
                  favorite.on ? 'remove from Favorites' : 'pin to Favorites'
                }
                className={cx(styles.icon, favorite.on && styles.iconOn)}
                onClick={e => {
                  e.preventDefault()
                  favorite.onToggle()
                }}
              >
                {favorite.on ? '★' : '☆'}
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
          style={fill}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          disabled={locked}
          onChange={e => props.onChange(Number(e.target.value))}
        />
      </label>
      {showHelp && help !== undefined ? (
        <SliderHelpDialog
          label={props.label}
          help={help}
          min={props.min}
          max={props.max}
          step={props.step}
          defaultValue={props.defaultValue}
          unit={props.unit}
          onClose={() => setShowHelp(false)}
        />
      ) : null}
    </div>
  )
}
