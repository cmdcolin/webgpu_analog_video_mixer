import { useEffect, useState } from 'react'
import type { Engine, ModSlot } from '../gpu/pipeline'
import type { ModSource } from '../signal/modstate'
import { GROUPS } from './controls'
import { Section } from './Section'
import { Slider } from './Slider'
import styles from '../app.module.css'

// Every slider is a bend point: flatten the groups into target options. The
// slider's range doubles as the modulation span, so depth stays meaningful
// across controls with wildly different units.
const TARGETS = GROUPS.flatMap(g =>
  g.sliders.map(s => ({
    key: s.key,
    label: `${s.label} — ${g.name}`,
    min: s.min,
    max: s.max,
  })),
)

const SOURCES: { id: ModSource; label: string }[] = [
  { id: 'sine', label: 'sine LFO' },
  { id: 'triangle', label: 'triangle LFO' },
  { id: 'walk', label: 'random walk' },
  { id: 'level', label: 'audio level' },
  { id: 'hit', label: 'audio hit' },
]

// The panel's tag-plus-dropdown row, shared by the target and source pickers.
function SelectRow(props: {
  tag: string
  title: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className={styles.inputRow}>
      <span className={styles.tag} title={props.title}>
        {props.tag}
      </span>
      <select
        className={styles.select}
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
      >
        {props.options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

interface UiSlot {
  target: string // '' = slot off; otherwise a ControlKey
  source: ModSource
  rateHz: number
  depth: number
}
const EMPTY: UiSlot = { target: '', source: 'sine', rateHz: 0.5, depth: 0.2 }
const N_SLOTS = 4
const MOD_STORE = 'video_feedback_mod'

function loadSlots(): UiSlot[] {
  const raw = localStorage.getItem(MOD_STORE)
  const stored = raw === null ? [] : (JSON.parse(raw) as UiSlot[])
  const valid = stored.filter(
    s => s.target === '' || TARGETS.some(t => t.key === s.target),
  )
  return Array.from({ length: N_SLOTS }, (_, i) =>
    i < valid.length ? valid[i] : EMPTY,
  )
}

export function ModSection(props: { engine: Engine | null }) {
  const [slots, setSlots] = useState<UiSlot[]>(loadSlots)

  // Push the active routings to the render loop. The engine applies them per
  // frame around its controls without writing through them, so sliders,
  // presets, and scenes keep the resting values.
  const engine = props.engine
  useEffect(() => {
    if (engine !== null) {
      engine.setModSlots(
        slots.flatMap((s): ModSlot[] => {
          const t = TARGETS.find(x => x.key === s.target)
          return t === undefined || s.depth === 0
            ? []
            : [
                {
                  target: t.key,
                  source: s.source,
                  rateHz: s.rateHz,
                  depth: s.depth,
                  min: t.min,
                  max: t.max,
                },
              ]
        }),
      )
    }
  }, [engine, slots])

  const set = (i: number, patch: Partial<UiSlot>) => {
    setSlots(prev => {
      const next = prev.map((s, j) => (j === i ? { ...s, ...patch } : s))
      localStorage.setItem(MOD_STORE, JSON.stringify(next))
      return next
    })
  }

  const anyActive = slots.some(s => s.target !== '' && s.depth > 0)
  return (
    <Section title="Modulation" defaultOpen={false} dot={anyActive}>
      <div className={styles.hint}>
        the bender&apos;s other hand: LFOs, drift, and the audio envelope
        wiggling any control around its slider setting.
      </div>
      {slots.map((s, i) => (
        // Slots are positional identities (slot 1..4), so the index IS the key.
        // eslint-disable-next-line @eslint-react/no-array-index-key
        <div key={i}>
          <SelectRow
            tag={String(i + 1)}
            title={`mod slot ${i + 1}`}
            value={s.target}
            options={[
              { value: '', label: 'off' },
              ...TARGETS.map(t => ({ value: t.key, label: t.label })),
            ]}
            onChange={target => set(i, { target })}
          />
          {s.target === '' ? null : (
            <>
              <SelectRow
                tag="∿"
                title="modulation source"
                value={s.source}
                options={SOURCES.map(src => ({
                  value: src.id,
                  label: src.label,
                }))}
                onChange={v => {
                  const src = SOURCES.find(x => x.id === v)
                  if (src !== undefined) set(i, { source: src.id })
                }}
              />
              {s.source === 'level' || s.source === 'hit' ? null : (
                <Slider
                  label="rate"
                  unit="Hz"
                  min={0.02}
                  max={10}
                  step={0.02}
                  value={s.rateHz}
                  defaultValue={EMPTY.rateHz}
                  onChange={v => set(i, { rateHz: v })}
                />
              )}
              <Slider
                label="depth (of slider range)"
                unit=""
                min={0}
                max={1}
                step={0.01}
                value={s.depth}
                defaultValue={EMPTY.depth}
                onChange={v => set(i, { depth: v })}
              />
            </>
          )}
        </div>
      ))}
    </Section>
  )
}
