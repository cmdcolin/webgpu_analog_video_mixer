import { useState, type ReactNode } from 'react'
import styles from '../app.module.css'

export function Section(props: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)
  return (
    <div>
      <h3 className={styles.head} onClick={() => setOpen(o => !o)}>
        <span>{props.title}</span>
        <span className={styles.caret}>{open ? '▾' : '▸'}</span>
      </h3>
      {open ? props.children : null}
    </div>
  )
}
