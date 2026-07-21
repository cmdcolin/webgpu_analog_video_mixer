import { useState, type ReactNode } from 'react'
import styles from '../app.module.css'

// Collapsed/open choices persist per title so a reload keeps your working set.
const STORE = 'video_feedback_sections'
function loadOpenMap(): Partial<Record<string, boolean>> {
  const raw = localStorage.getItem(STORE)
  return raw === null
    ? {}
    : (JSON.parse(raw) as Partial<Record<string, boolean>>)
}

export function Section(props: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  // Filtering: show contents regardless of the collapsed state.
  forceOpen?: boolean
  // Some control inside sits off its default.
  dot?: boolean
  // Optional accessory (e.g. a ? explainer) beside the title. It must stop its
  // own clicks from bubbling, or they toggle the section.
  help?: ReactNode
}) {
  const [open, setOpen] = useState(
    () => loadOpenMap()[props.title] ?? props.defaultOpen ?? true,
  )
  const shown = props.forceOpen === true || open
  const toggle = () => {
    const next = !open
    setOpen(next)
    localStorage.setItem(
      STORE,
      JSON.stringify({ ...loadOpenMap(), [props.title]: next }),
    )
  }
  return (
    <div>
      <h3 className={styles.head} onClick={toggle}>
        <span>
          {props.title}
          {props.dot === true ? <span className={styles.dot}> •</span> : null}
          {props.help}
        </span>
        <span className={styles.caret}>{shown ? '▾' : '▸'}</span>
      </h3>
      {shown ? props.children : null}
    </div>
  )
}
