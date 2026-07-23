import styles from '../app.module.css'
import { SOURCE_B_MODES, SOURCE_DESC, SOURCE_MODES } from '../sources/modes'
import { Section } from './Section'
import { SelectRow } from './SelectRow'

import type { SourceBMode, SourceMode } from '../sources/modes'
import type { RefObject } from 'react'

// The YouTube option is backed by the dev-only yt-dlp bridge, so hide it in
// production builds where the /yt endpoint doesn't exist.
const A_MODES = import.meta.env.DEV
  ? SOURCE_MODES
  : SOURCE_MODES.filter(m => m !== 'youtube')
const B_MODES = import.meta.env.DEV
  ? SOURCE_B_MODES
  : SOURCE_B_MODES.filter(m => m !== 'youtube')

const A_OPTIONS = A_MODES.map(m => ({ value: m, label: SOURCE_DESC[m] }))
const B_OPTIONS = B_MODES.map(m => ({ value: m, label: SOURCE_DESC[m] }))

// The source-name caption shows for loaded file/YouTube sources.
const namedMode = (m: SourceMode | SourceBMode): boolean =>
  m === 'file' || m === 'youtube'

// Clicking the caption re-fires the source handler, reopening the file picker
// (or YouTube URL dialog) — the native <select> can't re-emit onChange for the
// already-selected option, so re-picking the same source lives here.
function FileName({ name, onReopen }: { name: string; onReopen: () => void }) {
  return name === '' ? null : (
    <button
      type="button"
      className={styles.fileName}
      title={`${name} — click to change`}
      onClick={() => onReopen()}
    >
      {name}
    </button>
  )
}

export function InputSection(props: {
  sourceMode: SourceMode
  sourceName: string
  onSelectSource: (mode: SourceMode) => void
  sourceBMode: SourceBMode
  sourceBName: string
  onSelectSourceB: (mode: SourceBMode) => void
  webcamDeviceId: string
  videoDevices: MediaDeviceInfo[]
  onStartWebcam: (deviceId: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  fileInputBRef: RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
  onFileB: (file: File | undefined) => void
}) {
  return (
    <div>
      <Section title="Input" defaultOpen>
        <SelectRow
          tag="A"
          title="main source"
          value={props.sourceMode}
          options={A_OPTIONS}
          onChange={props.onSelectSource}
        />
        {namedMode(props.sourceMode) ? (
          <FileName
            name={props.sourceName}
            onReopen={() => props.onSelectSource(props.sourceMode)}
          />
        ) : null}
        {props.sourceMode === 'webcam' && props.videoDevices.length > 1 ? (
          <SelectRow
            tag="◉"
            title="capture device"
            value={props.webcamDeviceId}
            options={props.videoDevices.map((d, i) => ({
              value: d.deviceId,
              label: d.label === '' ? `Device ${i + 1}` : d.label,
            }))}
            onChange={props.onStartWebcam}
          />
        ) : null}
        <SelectRow
          tag="B"
          title="second source, mixed in dirty"
          value={props.sourceBMode}
          options={B_OPTIONS}
          onChange={props.onSelectSourceB}
        />
        {namedMode(props.sourceBMode) ? (
          <FileName
            name={props.sourceBName}
            onReopen={() => props.onSelectSourceB(props.sourceBMode)}
          />
        ) : null}
        {props.sourceBMode === 'none' ? (
          <div className={styles.hint}>
            pick a source B above to mix a second signal in.
          </div>
        ) : (
          <div className={styles.hint}>
            mix controls are in the A/B Mix section below.
          </div>
        )}
      </Section>
      {/* Hidden pickers stay mounted outside the collapsible Section, so a
          collapsed Input can still fire the file dialog through its ref. */}
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
    </div>
  )
}
