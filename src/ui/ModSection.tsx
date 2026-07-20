import { useEffect, useState } from 'react'
import type { ControlKey, Engine, ModSlot } from '../gpu/pipeline'
import type { ModSource } from '../signal/modstate'
import { GROUPS, SLIDER_BY_KEY } from './controls'
import { Section } from './Section'
import { Slider } from './Slider'
import styles from '../app.module.css'

// Every slider is a bend point: flatten the groups into target options. The
// slider's range doubles as the modulation span, so depth stays meaningful
// across controls with wildly different units.
const TARGET_OPTIONS = [
  { value: '' as const, label: 'off' },
  ...GROUPS.flatMap(g =>
    g.sliders.map(s => ({ value: s.key, label: `${s.label} — ${g.name}` })),
  ),
]

const SOURCES: { value: ModSource; label: string }[] = [
  { value: 'sine', label: 'sine LFO' },
  { value: 'triangle', label: 'triangle LFO' },
  { value: 'walk', label: 'random walk' },
  { value: 'level', label: 'audio level' },
  { value: 'hit', label: 'audio hit' },
]

// The panel's tag-plus-dropdown row, shared by the target and source pickers.
// Generic over the option values so callers get their own key type back
// instead of a bare string to re-validate.
function SelectRow<T extends string>(props: {
  tag: string
  title: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className={styles.inputRow}>
      <span className={styles.tag} title={props.title}>
        {props.tag}
      </span>
      <select
        className={styles.select}
        value={props.value}
        onChange={e => {
          const picked = props.options.find(o => o.value === e.target.value)
          if (picked !== undefined) props.onChange(picked.value)
        }}
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
  target: ControlKey | '' // '' = slot off
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
    s => s.target === '' || SLIDER_BY_KEY.has(s.target),
  )
  return Array.from({ length: N_SLOTS }, (_, i) =>
    i < valid.length ? valid[i] : EMPTY,
  )
}

export function ModSection(props: { engine: Engine | null }) {
  const [slots, setSlots] = useState<UiSlot[]>(loadSlots)

  const active = slots.flatMap((s): ModSlot[] => {
    const def = s.target === '' ? undefined : SLIDER_BY_KEY.get(s.target)
    return def === undefined || s.depth === 0
      ? []
      : [{ ...s, target: def.key, min: def.min, max: def.max }]
  })

  // Push the active routings to the render loop. The engine applies them per
  // frame around its controls without writing through them, so sliders,
  // presets, and scenes keep the resting values.
  const engine = props.engine
  useEffect(() => {
    if (engine !== null) {
      engine.setModSlots(active)
    }
  }, [engine, active])

  const set = (i: number, patch: Partial<UiSlot>) => {
    const next = slots.map((s, j) => (j === i ? { ...s, ...patch } : s))
    localStorage.setItem(MOD_STORE, JSON.stringify(next))
    setSlots(next)
  }
  return (
    <Section title="Modulation" defaultOpen={false} dot={active.length > 0}>
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
            options={TARGET_OPTIONS}
            onChange={target => set(i, { target })}
          />
          {s.target === '' ? null : (
            <>
              <SelectRow
                tag="∿"
                title="modulation source"
                value={s.source}
                options={SOURCES}
                onChange={source => set(i, { source })}
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
                  help="How fast this slot's LFO cycles, in Hz. Slow rates drift the target control the way a warming-up circuit does; fast ones buzz it per-frame."
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
                help="How far the modulation swings the target, as a fraction of that control's own slider range. The resting slider position stays the centre, so presets and scenes still hold the look."
                onChange={v => set(i, { depth: v })}
              />
            </>
          )}
        </div>
      ))}
    </Section>
  )
}
