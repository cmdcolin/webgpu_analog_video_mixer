import styles from '../app.module.css'
import { cx } from './cx'
import type { MidiStatus } from './midi'
import { Dialog } from './Dialog'
import { Slider } from './Slider'

export function AdvancedDialog(props: {
  renderScale: number
  onScaleChange: (v: number) => void
  res: string
  midiStatus: MidiStatus
  onEnableMidi: () => void
  onClose: () => void
}) {
  return (
    <Dialog title="Advanced" onClose={props.onClose}>
      <Slider
        label="render scale"
        unit="x"
        min={0.25}
        max={2}
        step={0.05}
        value={props.renderScale}
        defaultValue={1}
        onChange={props.onScaleChange}
      />
      <div className={styles.dim} style={{ margin: '2px 0 12px' }}>
        backing-store resolution · lower = faster · {props.res}
      </div>
      <div className={styles.subhead}>MIDI control</div>
      {props.midiStatus === 'idle' ? (
        <button
          className={cx(styles.btn, styles.btnFlush)}
          onClick={props.onEnableMidi}
        >
          enable MIDI
        </button>
      ) : null}
      {props.midiStatus === 'requesting' ? (
        <div className={styles.muted}>requesting access…</div>
      ) : null}
      {props.midiStatus === 'unsupported' ? (
        <div className={styles.warn}>
          Web MIDI not supported in this browser.
        </div>
      ) : null}
      {props.midiStatus === 'denied' ? (
        <div className={styles.err}>
          Access denied.{' '}
          <button
            className={cx(styles.btn, styles.btnFlush)}
            onClick={props.onEnableMidi}
          >
            retry
          </button>
        </div>
      ) : null}
      {props.midiStatus === 'ready' ? (
        <div className={styles.ok}>
          enabled — bind knobs from the MIDI panel in the sidebar.
        </div>
      ) : null}
      <div className={styles.dim} style={{ margin: '4px 0 0' }}>
        map a hardware controller to any slider; sync rates to MIDI clock.
      </div>
    </Dialog>
  )
}
