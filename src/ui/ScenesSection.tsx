import type { Controls } from '../controls'
import styles from '../app.module.css'
import { cx } from './cx'
import { Section } from './Section'
import { CONTROL_KEYS, presetControls } from './presets'

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

// Numbered snapshot slots for live sets: presets are authored looks, scenes
// are yours for tonight. Recall/save also ride the 1–9 keys (see app.tsx).
export function ScenesSection(props: {
  controls: Controls
  scenes: Partial<Record<string, Partial<Controls>>>
  onSave: (n: number) => void
  onRecall: (n: number) => void
  onClear: (n: number) => void
}) {
  return (
    <Section title="Scenes" defaultOpen={false}>
      {SLOTS.map(n => {
        const scene = props.scenes[n]
        const full = scene === undefined ? undefined : presetControls(scene)
        const isActive =
          full !== undefined &&
          CONTROL_KEYS.every(k => full[k] === props.controls[k])
        return (
          <button
            key={n}
            className={cx(
              styles.btn,
              scene === undefined && styles.slotEmpty,
              isActive && styles.active,
            )}
            title={
              scene === undefined
                ? `save the current look to scene ${n}`
                : `scene ${n} — click to recall · shift+click to overwrite · alt+click to clear`
            }
            onClick={e => {
              if (scene === undefined || e.shiftKey) props.onSave(n)
              else if (e.altKey) props.onClear(n)
              else props.onRecall(n)
            }}
          >
            {n}
          </button>
        )
      })}
      <div className={styles.hint}>
        snapshots of the whole board — keys 1–9 recall · shift+1–9 save
      </div>
    </Section>
  )
}
