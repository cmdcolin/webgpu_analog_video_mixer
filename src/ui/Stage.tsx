import type { RefObject } from 'react'
import type { FrameStats } from '../controls'
import { CameraIcon, GearIcon } from './icons'
import { FpsMonitor } from './FpsMonitor'
import { cx } from './cx'
import { Popover } from './Popover'
import { usePersistedFlag } from './storage'
import popoverStyles from './Popover.module.css'
import styles from './Stage.module.css'

// Persisted across reloads so a collapse sticks.
const BAR_HIDDEN_STORE = 'phosphene_overlay_bar_hidden'

function CaptureMenu(props: {
  recording: boolean
  onGrabStill: () => void
  onToggleRecord: () => void
}) {
  return (
    <Popover
      trigger={toggle => (
        <button
          className={cx(
            styles.overlayBtn,
            props.recording && styles.recording,
          )}
          onClick={toggle}
          title={
            props.recording
              ? 'recording — click for capture options'
              : 'capture options (s: still, r: record)'
          }
        >
          <CameraIcon /> {props.recording ? 'rec' : 'capture'}
        </button>
      )}
    >
      {close => (
        <>
          <button
            className={popoverStyles.menuItem}
            onClick={() => {
              props.onGrabStill()
              close()
            }}
          >
            <span>◍ save still</span>
            <span className={popoverStyles.menuHint}>s</span>
          </button>
          <button
            className={popoverStyles.menuItem}
            onClick={() => {
              props.onToggleRecord()
              close()
            }}
          >
            <span>
              {props.recording ? '■ stop recording' : '● start recording'}
            </span>
            <span className={popoverStyles.menuHint}>r</span>
          </button>
        </>
      )}
    </Popover>
  )
}

export function Stage(props: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  error: string
  stats: FrameStats
  res: string
  fullscreen: boolean
  poppedOut: boolean
  recording: boolean
  onToggleRecord: () => void
  onGrabStill: () => void
  onToggleFullscreen: () => void
  onPopout: () => void
  onShowHelp: () => void
  onShowAdvanced: () => void
}) {
  const [barHidden, setBarHidden] = usePersistedFlag(BAR_HIDDEN_STORE)
  return (
    <div className={styles.stage}>
      <canvas ref={props.canvasRef} className={styles.canvas} />
      {props.error !== '' && <div className={styles.error}>{props.error}</div>}
      {barHidden ? (
        <button
          className={styles.reopenBar}
          onClick={() => setBarHidden(false)}
          title="show controls"
        >
          ⋯
        </button>
      ) : (
        <div className={styles.overlayBar}>
          <CaptureMenu
            recording={props.recording}
            onGrabStill={props.onGrabStill}
            onToggleRecord={props.onToggleRecord}
          />
          <button
            className={styles.overlayBtn}
            style={{ fontWeight: 700 }}
            onClick={props.onShowHelp}
            title="help / about"
          >
            ?
          </button>
          <button
            className={styles.overlayBtn}
            onClick={props.onShowAdvanced}
            title="advanced settings"
          >
            <GearIcon />
          </button>
          <button
            className={styles.overlayBtn}
            onClick={props.onPopout}
            title={
              props.poppedOut
                ? 'controls are in their own window — click to focus it'
                : 'pop controls into their own window (for a second screen)'
            }
          >
            ⧉ {props.poppedOut ? 'controls ↗' : 'pop out'}
          </button>
          <button
            className={styles.overlayBtn}
            onClick={props.onToggleFullscreen}
            title="toggle fullscreen (f)"
          >
            {props.fullscreen ? '⤢ exit' : '⛶ fullscreen'}
          </button>
          <button
            className={styles.overlayBtn}
            onClick={() => setBarHidden(true)}
            title="hide controls"
          >
            ×
          </button>
        </div>
      )}
      <FpsMonitor stats={props.stats} res={props.res} />
    </div>
  )
}
