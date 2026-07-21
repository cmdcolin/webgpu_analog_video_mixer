import styles from '../app.module.css'

// A leading tag glyph plus a full-width dropdown — the panel's standard picker
// row. Generic over the option values so callers get their own key type back
// instead of a bare string to re-validate.
export function SelectRow<T extends string>(props: {
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
