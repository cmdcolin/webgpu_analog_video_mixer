import styles from '../app.module.css'
import { cx } from './cx'

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={cx(styles.card, styles.cardWide)}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.cardRow} style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Phosphene</h2>
          <button
            className={styles.btn}
            style={{ margin: 0 }}
            onClick={onClose}
          >
            close
          </button>
        </div>
        <p className={styles.helpText}>
          A real-time simulator of the analog NTSC signal path — camera, tape,
          RF, and CRT — rendered entirely in WebGPU compute shaders. Feed it a
          pattern, image, video, or your webcam and degrade it however you like.
        </p>
        <div className={styles.helpHead}>Getting started</div>
        <ol className={styles.helpList}>
          <li>
            Pick an <b>Input</b> (A is the main source; B mixes a second in).
          </li>
          <li>
            Click a <b>Preset</b> for an instant look, then tweak the sliders
            below.
          </li>
        </ol>
        <div className={styles.helpHead}>Keyboard</div>
        <ul className={styles.helpList}>
          <li>
            <b>C</b> (hold) compare against the clean signal
          </li>
          <li>
            <b>F</b> fullscreen · <b>Esc</b> close dialogs
          </li>
        </ul>
        <div className={styles.helpHead}>More</div>
        <p className={styles.muted} style={{ margin: 0 }}>
          The <b>gear</b> icon holds render scale and MIDI setup. Source code
          and notes on{' '}
          <a
            className={styles.link}
            href="https://github.com/cmdcolin/phosphene"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
          .
        </p>
      </div>
    </div>
  )
}
