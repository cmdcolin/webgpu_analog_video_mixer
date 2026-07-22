import { useState } from 'react'

import styles from './MiniFrame.module.css'
import { cx } from './cx'
import { clamp01, snapOffset } from './miniFrame'

import type { KeyboardEvent, PointerEvent } from 'react'

export interface PipBox {
  x: number
  y: number
  w: number
  h: number
}

interface Drag {
  sx: number
  sy: number
  px: number
  py: number
  fw: number
  fh: number
  start: PipBox
}

const MIN_SIZE = 0.1
const clampSize = (v: number) => Math.min(1, Math.max(MIN_SIZE, v))

// Corner and edge grips, as (sx, sy) in {-1, 0, 1}: which edges each one moves.
const GRIPS = [
  { sx: -1, sy: -1 },
  { sx: 0, sy: -1 },
  { sx: 1, sy: -1 },
  { sx: -1, sy: 0 },
  { sx: 1, sy: 0 },
  { sx: -1, sy: 1 },
  { sx: 0, sy: 1 },
  { sx: 1, sy: 1 },
]
const CURSORS: Record<string, string> = {
  '-1,-1': 'nwse-resize',
  '1,1': 'nwse-resize',
  '1,-1': 'nesw-resize',
  '-1,1': 'nesw-resize',
  '0,-1': 'ns-resize',
  '0,1': 'ns-resize',
  '-1,0': 'ew-resize',
  '1,0': 'ew-resize',
}
const NUDGE = new Map([
  ['ArrowLeft', { du: -1, dv: 0 }],
  ['ArrowRight', { du: 1, dv: 0 }],
  ['ArrowUp', { du: 0, dv: -1 }],
  ['ArrowDown', { du: 0, dv: 1 }],
])

// Move one edge while its opposite stays pinned, in the center/size parameters
// the shader actually reads.
const resizeAxis = (center: number, size: number, s: number, edge: number) => {
  const pinned = center - (s * size) / 2
  const next = clampSize(Math.abs(edge - pinned))
  return { center: clamp01(pinned + (s * next) / 2), size: next }
}

export function PipFrame(props: {
  box: PipBox
  inert: boolean
  onChange: (box: PipBox) => void
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const { x, y, w, h } = props.box
  const winStyle = {
    left: `${(x - w / 2) * 100}%`,
    top: `${(y - h / 2) * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
  }
  // Grips are siblings of the window rather than children, so every draggable
  // element's parent is the frame whose pixel size converts the drag.
  const begin =
    (sx: number, sy: number) => (e: PointerEvent<HTMLDivElement>) => {
      const frame = e.currentTarget.parentElement
      if (frame !== null) {
        const r = frame.getBoundingClientRect()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDrag({
          sx,
          sy,
          px: e.clientX,
          py: e.clientY,
          fw: r.width,
          fh: r.height,
          start: props.box,
        })
      }
    }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag !== null) {
      const s = drag.start
      // alt drags raw; shift constrains — one axis when moving, the aspect
      // ratio when pulling a corner.
      const snap = !e.altKey
      const rawU = (e.clientX - drag.px) / drag.fw
      const rawV = (e.clientY - drag.py) / drag.fh
      const lock = e.shiftKey
      if (drag.sx === 0 && drag.sy === 0) {
        const axis =
          !lock || Math.abs(rawU) >= Math.abs(rawV)
            ? { du: rawU, dv: lock ? 0 : rawV }
            : { du: 0, dv: rawV }
        const cx0 = s.x - s.w / 2 + axis.du
        const cy0 = s.y - s.h / 2 + axis.dv
        const du = axis.du + snapOffset([cx0, cx0 + s.w, cx0 + s.w / 2], snap)
        const dv = axis.dv + snapOffset([cy0, cy0 + s.h, cy0 + s.h / 2], snap)
        props.onChange({
          x: clamp01(s.x + du),
          y: clamp01(s.y + dv),
          w: s.w,
          h: s.h,
        })
      } else {
        const edgeU = s.x + (drag.sx * s.w) / 2 + rawU
        const edgeV = s.y + (drag.sy * s.h) / 2 + rawV
        const hx = resizeAxis(
          s.x,
          s.w,
          drag.sx,
          edgeU + snapOffset([edgeU], snap && drag.sx !== 0),
        )
        const hy = resizeAxis(
          s.y,
          s.h,
          drag.sy,
          edgeV + snapOffset([edgeV], snap && drag.sy !== 0),
        )
        // shift on a corner keeps the aspect: height follows the new width
        // and the pinned corner stays put.
        const pinnedV = s.y - (drag.sy * s.h) / 2
        const tiedH = clampSize(hx.size * (s.h / s.w))
        const tied =
          lock && drag.sx !== 0 && drag.sy !== 0
            ? { center: clamp01(pinnedV + (drag.sy * tiedH) / 2), size: tiedH }
            : hy
        props.onChange({
          x: drag.sx === 0 ? s.x : hx.center,
          y: drag.sy === 0 ? s.y : tied.center,
          w: drag.sx === 0 ? s.w : hx.size,
          h: drag.sy === 0 ? s.h : tied.size,
        })
      }
    }
  }
  const end = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDrag(null)
  }
  // Arrows walk the window, alt+arrows size it — the geometry stays reachable
  // without a pointer now that the four sliders are gone.
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = NUDGE.get(e.key)
    if (step !== undefined) {
      e.preventDefault()
      const d = e.shiftKey ? 0.05 : 0.005
      props.onChange(
        e.altKey
          ? {
              x,
              y,
              w: clampSize(w + step.du * d * 2),
              h: clampSize(h + step.dv * d * 2),
            }
          : { x: clamp01(x + step.du * d), y: clamp01(y + step.dv * d), w, h },
      )
    }
  }
  return (
    <div className={styles.wrap}>
      <div
        className={cx(styles.frame, props.inert && styles.inert)}
        title={
          props.inert
            ? 'inset key is at 0 — the window is not on air'
            : undefined
        }
      >
        <div
          className={styles.window}
          style={winStyle}
          tabIndex={0}
          title="drag to place · shift locks an axis · alt drags off the guides"
          onPointerDown={e => begin(0, 0)(e)}
          onPointerMove={e => move(e)}
          onPointerUp={e => end(e)}
          onPointerCancel={e => end(e)}
          onKeyDown={e => key(e)}
        />
        {GRIPS.map(g => (
          <div
            key={`${g.sx},${g.sy}`}
            className={styles.grip}
            style={{
              left: `${(x + (g.sx * w) / 2) * 100}%`,
              top: `${(y + (g.sy * h) / 2) * 100}%`,
              cursor: CURSORS[`${g.sx},${g.sy}`],
            }}
            onPointerDown={e => begin(g.sx, g.sy)(e)}
            onPointerMove={e => move(e)}
            onPointerUp={e => end(e)}
            onPointerCancel={e => end(e)}
          />
        ))}
      </div>
      <div className={styles.readout}>
        <span>drag · grips resize · ⇧ locks</span>
        <span className={styles.nums}>
          {`x ${x.toFixed(2)} y ${y.toFixed(2)} · ${Math.round(w * 100)}×${Math.round(h * 100)}%`}
        </span>
      </div>
    </div>
  )
}
