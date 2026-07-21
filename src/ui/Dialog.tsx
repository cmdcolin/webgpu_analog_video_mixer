import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from '../app.module.css'
import { cx } from './cx'

// Shared modal shell built on the native <dialog> element: showModal() puts it
// in the top layer (no z-index juggling), traps focus, makes the rest of the
// page inert, and turns Escape into a `cancel` event — all for free. The card is
// an inner box so a click lands on the backdrop (the dialog element itself) only
// when it misses the card. Opens in whichever document it's portaled into, so it
// works in the popout window too.
export function Dialog(props: {
  title: ReactNode
  onClose: () => void
  wide?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const { onClose } = props

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    el.showModal()
    // showModal focuses the first tabbable (the close button); honor an opt-in
    // field that would rather have it, like the YouTube URL box.
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => {
      if (el.open) el.close()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={e => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className={cx(styles.card, props.wide === true && styles.cardWide)}>
        <div className={styles.cardRow}>
          <h2 id={titleId} className={styles.h2}>
            {props.title}
          </h2>
          <button className={cx(styles.btn, styles.btnFlush)} onClick={onClose}>
            close
          </button>
        </div>
        {props.children}
      </div>
    </dialog>
  )
}
