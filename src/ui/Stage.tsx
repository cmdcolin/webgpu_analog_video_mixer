import type { RefObject } from 'react'
import { GearIcon } from './icons'
import styles from './Stage.module.css'

export function Stage(props: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  error: string
  fps: number
  res: string
  fullscreen: boolean
  onToggleFullscreen: () => void
  onShowHelp: () => void
  onShowAdvanced: () => void
}) {
  return (
    <div className={styles.stage}>
      <canvas ref={props.canvasRef} className={styles.canvas} />
      {props.error !== '' && <div className={styles.error}>{props.error}</div>}
      <div className={styles.overlayBar}>
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
          onClick={props.onToggleFullscreen}
          title="toggle fullscreen (f)"
        >
          {props.fullscreen ? '⤢ exit' : '⛶ fullscreen'}
        </button>
      </div>
      <div className={styles.stats}>
        {props.fps.toFixed(0)} fps · {props.res}
      </div>
    </div>
  )
}
