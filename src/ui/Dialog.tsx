import { useEffect, useRef, type ReactNode } from 'react'
import styles from '../app.module.css'
import { cx } from './cx'

// Shared modal shell: a dimmed backdrop that closes on outside click or Escape,
// a centered card, and a title row with a close button. Escape is bound to the
// dialog's own document, so it also works when the panel lives in the popout
// window — a listener on the main window would never see the key there.
export function Dialog(props: {
  title: ReactNode
  onClose: () => void
  wide?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = props
  useEffect(() => {
    const doc = ref.current?.ownerDocument
    if (doc === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    doc.addEventListener('keydown', onKey)
    return () => doc.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className={styles.backdrop} ref={ref} onClick={onClose}>
      <div
        className={cx(styles.card, props.wide === true && styles.cardWide)}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.cardRow}>
          <h2 className={styles.h2}>{props.title}</h2>
          <button className={cx(styles.btn, styles.btnFlush)} onClick={onClose}>
            close
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}
