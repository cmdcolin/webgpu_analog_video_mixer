import type { ControlKey } from '../gpu/pipeline'
import styles from '../app.module.css'
import { cx } from './cx'
import { GROUPS } from './controls'
import type { BindingMap } from './midi'
import { Section } from './Section'

const LABEL_BY_KEY = new Map(
  GROUPS.flatMap(g => g.sliders).map(s => [s.key, s.label]),
)

export function MidiSection(props: {
  armedKey: ControlKey | null
  midiBindings: BindingMap
  bpm: number | null
  onClearBinding: (key: ControlKey) => void
  onClearAll: () => void
}) {
  return (
    <Section title="MIDI">
      <>
        <div className={styles.hint}>
          {props.armedKey === null
            ? 'click ⚟ on any slider, then move a knob to bind. knobs soft-take-over (no jumps).'
            : `learning ${LABEL_BY_KEY.get(props.armedKey) ?? props.armedKey}… move a knob (Esc to cancel)`}
        </div>
        {Object.entries(props.midiBindings).map(([key, b]) => (
          <div key={key} className={styles.midiRow}>
            <span>
              {LABEL_BY_KEY.get(key as ControlKey) ?? key}{' '}
              <span className={styles.blue}>· CC{b.controller}</span>
              {b.channel === 0 ? (
                ''
              ) : (
                <span className={styles.dim}> ch{b.channel + 1}</span>
              )}
            </span>
            <button
              className={styles.iconX}
              onClick={() => props.onClearBinding(key as ControlKey)}
            >
              ×
            </button>
          </div>
        ))}
        {Object.keys(props.midiBindings).length === 0 ? null : (
          <button
            className={cx(styles.btn, styles.danger)}
            onClick={props.onClearAll}
          >
            clear all bindings
          </button>
        )}
        <div
          className={props.bpm === null ? styles.dim : styles.amber}
          style={{ margin: '8px 0 2px' }}
        >
          {props.bpm === null
            ? 'clock ♩ — no signal'
            : `clock ♩ = ${props.bpm.toFixed(1)} BPM`}
        </div>
        <div className={styles.dim} style={{ margin: '0 0 2px' }}>
          click ♩ on a rate slider (sweep, line offset) to lock it to the beat.
        </div>
      </>
    </Section>
  )
}
