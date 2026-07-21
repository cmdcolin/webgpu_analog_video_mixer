import { useState } from 'react'
import type { ControlKey } from '../controls'
import styles from '../app.module.css'
import { cx } from './cx'
import { GROUPS } from './controls'
import type { BindingMap, DeviceProfile, LearnState } from './midi'
import { DEVICE_PROFILES } from './midi'
import { Section } from './Section'

const LABEL_BY_KEY = new Map(
  GROUPS.flatMap(g => g.sliders).map(s => [s.key, s.label]),
)

const TOTAL_CONTROLS = GROUPS.flatMap(g => g.sliders).length

export function MidiSection(props: {
  armedKey: ControlKey | null
  learn: LearnState | null
  midiBindings: BindingMap
  bpm: number | null
  onAutoMap: (profile: DeviceProfile) => void
  onLearnSequence: () => void
  onStopLearn: () => void
  onClearBinding: (key: ControlKey) => void
  onClearAll: () => void
}) {
  const [deviceName, setDeviceName] = useState(DEVICE_PROFILES[0].name)
  const device =
    DEVICE_PROFILES.find(d => d.name === deviceName) ?? DEVICE_PROFILES[0]
  const bound = Object.keys(props.midiBindings).length
  const { learn, armedKey } = props
  const nextKey = learn?.nextKey ?? null
  const learnLabel =
    nextKey === null ? '' : (LABEL_BY_KEY.get(nextKey) ?? nextKey)

  const hint =
    learn !== null
      ? `turn a knob for: ${learnLabel} — ${learn.done}/${learn.total} bound (Esc to stop)`
      : armedKey === null
        ? 'click ⚟ on any slider, then move a knob to bind. knobs soft-take-over (no jumps).'
        : `learning ${LABEL_BY_KEY.get(armedKey) ?? armedKey}… move a knob (Esc to cancel)`

  return (
    <Section title="MIDI">
      <>
        <div className={learn === null ? styles.hint : styles.amber}>{hint}</div>

        {learn === null ? (
          <>
            <div className={styles.midiRow}>
              <select
                className={styles.select}
                value={deviceName}
                onChange={e => setDeviceName(e.target.value)}
              >
                {DEVICE_PROFILES.map(d => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                className={styles.btn}
                onClick={() => props.onAutoMap(device)}
              >
                auto-map
              </button>
              <button
                className={styles.btn}
                onClick={() => props.onLearnSequence()}
              >
                learn in order
              </button>
            </div>
            <div className={styles.dim} style={{ margin: '0 0 6px' }}>
              auto-map assigns the first{' '}
              {Math.min(device.ccs.length, TOTAL_CONTROLS)} controls to its knobs
              by CC. learn in order works for any controller: sweep each knob
              once, left to right. either way, set once then work from the box.
              {bound < TOTAL_CONTROLS && bound > 0
                ? ` ${TOTAL_CONTROLS - bound} controls have no knob; reach those on-screen or bind by hand.`
                : ''}
            </div>
          </>
        ) : (
          <button
            className={styles.btn}
            style={{ margin: '0 0 6px' }}
            onClick={() => props.onStopLearn()}
          >
            stop learning
          </button>
        )}

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
        {bound === 0 ? null : (
          <button
            className={cx(styles.btn, styles.danger)}
            onClick={() => props.onClearAll()}
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
