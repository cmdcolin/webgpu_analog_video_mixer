import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './Popover.module.css'

// Generic click-to-open menu anchored to its trigger. Closes on outside
// pointerdown or when a menu item calls the close callback it's handed.
export function Popover(props: {
  trigger: (toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {props.trigger(() => setOpen(o => !o))}
      {open && (
        <div className={styles.menu}>{props.children(() => setOpen(false))}</div>
      )}
    </div>
  )
}
