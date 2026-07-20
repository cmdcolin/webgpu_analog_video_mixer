import type { ReactNode, RefObject } from 'react'
import styles from '../app.module.css'
import {
  SOURCE_B_MODES,
  SOURCE_DESC,
  SOURCE_MODES,
  type SourceBMode,
  type SourceMode,
} from '../sources/modes'
import { cx } from './cx'
import { GROUPS, type Group } from './controls'

// A/B mix groups live next to the Input row, shown only when B is enabled.
const AB_GROUPS = GROUPS.filter(g => g.ab)

export function InputSection(props: {
  sourceMode: SourceMode
  onSelectSource: (mode: SourceMode) => void
  sourceBMode: SourceBMode
  onSelectSourceB: (mode: SourceBMode) => void
  webcamDeviceId: string
  videoDevices: MediaDeviceInfo[]
  onStartWebcam: (deviceId: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  fileInputBRef: RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
  onFileB: (file: File | undefined) => void
  renderGroup: (group: Group, defaultOpen: boolean) => ReactNode
}) {
  return (
    <div>
      <div className={cx(styles.head, styles.static)}>Input</div>
      <div className={styles.inputRow}>
        <span className={styles.tag} title="main source">
          A
        </span>
        <select
          className={styles.select}
          value={props.sourceMode}
          onChange={e => {
            const m = SOURCE_MODES.find(x => x === e.target.value)
            if (m !== undefined) props.onSelectSource(m)
          }}
        >
          {SOURCE_MODES.map(mode => (
            <option key={mode} value={mode}>
              {SOURCE_DESC[mode]}
            </option>
          ))}
        </select>
      </div>
      {props.sourceMode === 'webcam' && props.videoDevices.length > 1 ? (
        <div className={styles.inputRow}>
          <span className={styles.tag} title="capture device">
            ◉
          </span>
          <select
            className={styles.select}
            value={props.webcamDeviceId}
            onChange={e => props.onStartWebcam(e.target.value)}
          >
            {props.videoDevices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label === '' ? `Device ${i + 1}` : d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className={styles.inputRow}>
        <span className={styles.tag} title="second source, mixed in dirty">
          B
        </span>
        <select
          className={styles.select}
          value={props.sourceBMode}
          onChange={e => {
            const m = SOURCE_B_MODES.find(x => x === e.target.value)
            if (m !== undefined) props.onSelectSourceB(m)
          }}
        >
          {SOURCE_B_MODES.map(mode => (
            <option key={mode} value={mode}>
              {SOURCE_DESC[mode]}
            </option>
          ))}
        </select>
      </div>
      <input
        ref={props.fileInputRef}
        type="file"
        accept="video/*,image/*"
        style={{ display: 'none' }}
        onChange={e => {
          props.onFile(e.target.files?.[0])
          e.target.value = '' // allow re-picking the same file
        }}
      />
      <input
        ref={props.fileInputBRef}
        type="file"
        accept="video/*,image/*"
        style={{ display: 'none' }}
        onChange={e => {
          props.onFileB(e.target.files?.[0])
          e.target.value = '' // allow re-picking the same file
        }}
      />
      {props.sourceBMode === 'none' ? (
        <div className={styles.hint}>
          pick a source B above to mix a second signal in.
        </div>
      ) : (
        // Open the primary B mix; collapse the alternative compositors
        // (wipe, PiP) so enabling B doesn't unfurl every slider at once.
        AB_GROUPS.map((group, i) => props.renderGroup(group, i === 0))
      )}
    </div>
  )
}
