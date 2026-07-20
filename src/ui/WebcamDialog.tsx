import styles from '../app.module.css'

export function WebcamDialog(props: {
  onContinue: () => void
  onClose: () => void
}) {
  return (
    <div className={styles.backdrop} onClick={props.onClose}>
      <div className={styles.card} onClick={e => e.stopPropagation()}>
        <div className={styles.cardRow} style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Connect a video device</h2>
          <button
            className={styles.btn}
            style={{ margin: 0 }}
            onClick={props.onClose}
          >
            close
          </button>
        </div>
        <p className={styles.helpText}>
          Feed in a live camera, or a real analog signal via a USB video-capture
          device — plug an RCA/composite “grabber” into the machine and it shows
          up as a camera. Your browser will ask for camera permission when you
          continue; pick the capture device from the list that appears
          afterward.
        </p>
        <button
          className={styles.btn}
          style={{ margin: 0 }}
          onClick={props.onContinue}
        >
          Continue
        </button>
      </div>
    </div>
  )
}
