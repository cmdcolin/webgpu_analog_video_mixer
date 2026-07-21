import { useState, type RefObject } from 'react'
import type { FrameStats } from '../controls'
import { GearIcon } from './icons'
import { FpsMonitor } from './FpsMonitor'
import { cx } from './cx'
import styles from './Stage.module.css'

// Persisted across reloads so a collapse sticks.
const BAR_HIDDEN_STORE = 'phosphene_overlay_bar_hidden'
const loadBarHidden = (): boolean =>
  localStorage.getItem(BAR_HIDDEN_STORE) === '1'

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
  const [barHidden, setBarHidden] = useState(loadBarHidden)
  const setPersistedBarHidden = (next: boolean) => {
    setBarHidden(next)
    localStorage.setItem(BAR_HIDDEN_STORE, next ? '1' : '0')
  }
  return (
    <div className={styles.stage}>
      <canvas ref={props.canvasRef} className={styles.canvas} />
      {props.error !== '' && <div className={styles.error}>{props.error}</div>}
      {barHidden ? (
        <button
          className={styles.reopenBar}
          onClick={() => setPersistedBarHidden(false)}
          title="show controls"
        >
          ⋯
        </button>
      ) : (
        <div className={styles.overlayBar}>
          <button
            className={styles.overlayBtn}
            onClick={props.onGrabStill}
            title="save a PNG still (s)"
          >
            ◍ still
          </button>
          <button
            className={cx(
              styles.overlayBtn,
              props.recording && styles.recording,
            )}
            onClick={props.onToggleRecord}
            title={
              props.recording
                ? 'stop recording and save the .webm clip (r)'
                : 'record the stage to a .webm clip (r)'
            }
          >
            {props.recording ? '■ stop' : '● rec'}
          </button>
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
            onClick={() => setPersistedBarHidden(true)}
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
