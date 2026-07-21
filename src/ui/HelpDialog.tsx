import styles from '../app.module.css'
import { Dialog } from './Dialog'

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Phosphene" wide onClose={onClose}>
      <p className={styles.helpText}>
        A real-time simulator of the analog NTSC signal path — camera, tape, RF,
        and CRT — rendered entirely in WebGPU compute shaders. Feed it a pattern,
        image, video, or your webcam and degrade it however you like.
      </p>
      <div className={styles.helpHead}>getting started</div>
      <ol className={styles.helpList}>
        <li>
          Pick an <b>Input</b> (A is the main source; B mixes a second in).
        </li>
        <li>
          Click a <b>Preset</b> for an instant look, then tweak the sliders
          below.
        </li>
        <li>
          Every slider has a <b>?</b> explaining the hardware fault it models.
        </li>
      </ol>
      <div className={styles.helpHead}>keyboard</div>
      <ul className={styles.helpList}>
        <li>
          <b>C</b> (hold) compare against the clean signal
        </li>
        <li>
          <b>R</b> record a clip · <b>S</b> save a still (both download)
        </li>
        <li>
          <b>F</b> fullscreen · <b>Esc</b> close dialogs · <b>Ctrl/⌘+Z</b> undo
        </li>
        <li>
          <b>1–9</b> recall a scene · <b>shift+1–9</b> save the current look
        </li>
      </ul>
      <div className={styles.helpHead}>more</div>
      <p className={styles.muted} style={{ margin: 0 }}>
        The <b>gear</b> icon holds render scale and MIDI setup. <b>⧉ pop out</b>{' '}
        moves the controls into their own window — handy with the stage
        fullscreen on a projector. Source code and notes on{' '}
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
    </Dialog>
  )
}
