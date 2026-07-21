import { cx } from './cx'
import { Dialog } from './Dialog'
import styles from '../app.module.css'

export function WebcamDialog(props: {
  onContinue: () => void
  onClose: () => void
}) {
  return (
    <Dialog title="Connect a video device" onClose={props.onClose}>
      <p className={styles.helpText}>
        Feed in a live camera, or a real analog signal via a USB video-capture
        device — plug an RCA/composite “grabber” into the machine and it shows up
        as a camera. Your browser will ask for camera permission when you
        continue; pick the capture device from the list that appears afterward.
      </p>
      <button
        className={cx(styles.btn, styles.btnFlush)}
        onClick={props.onContinue}
      >
        Continue
      </button>
    </Dialog>
  )
}
