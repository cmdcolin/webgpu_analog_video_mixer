import styles from '../app.module.css'

// Thin horizontal level bar, filled 0–100% from a normalized level (clamped).
// Used for both the mic input and the routed-audio onset levels.
export function Meter({ level }: { level: number }) {
  return (
    <div className={styles.meter}>
      <div
        className={styles.meterFill}
        style={{ width: `${Math.min(level * 100, 100).toFixed(1)}%` }}
      />
    </div>
  )
}
