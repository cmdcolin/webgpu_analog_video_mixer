import { useState } from 'react'

import styles from './MiniFrame.module.css'
import { cx } from './cx'
import { snapOffset, uvIn } from './miniFrame'

import type { CSSProperties, PointerEvent } from 'react'

// The B region each pattern opens, mirroring the generator in mix_b.wgsl:
// B wins where `pos` exceeds the pattern's distance function.
interface Shape {
  pos: (u: number, v: number) => number
  box: (p: number) => CSSProperties
}
const SHAPES = new Map<number, Shape>([
  [
    1,
    {
      pos: (u: number) => u,
      box: p => ({ left: 0, top: 0, width: `${p * 100}%`, height: '100%' }),
    },
  ],
  [
    2,
    {
      pos: (_u: number, v: number) => v,
      box: p => ({ left: 0, top: 0, width: '100%', height: `${p * 100}%` }),
    },
  ],
  [
    3,
    {
      pos: (u: number, v: number) =>
        Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2,
      box: p => ({
        left: `${(0.5 - p / 2) * 100}%`,
        top: `${(0.5 - p / 2) * 100}%`,
        width: `${p * 100}%`,
        height: `${p * 100}%`,
      }),
    },
  ],
  [
    4,
    {
      pos: (u: number, v: number) => Math.abs(u - 0.5) + Math.abs(v - 0.5),
      box: p => ({
        left: `${(0.5 - p) * 100}%`,
        top: `${(0.5 - p) * 100}%`,
        width: `${p * 200}%`,
        height: `${p * 200}%`,
        clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
      }),
    },
  ],
])

export function WipeFrame(props: {
  mode: number
  pos: number
  inert: boolean
  onChange: (pos: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const shape = SHAPES.get(Math.round(props.mode))
  // The pointer sits on the wipe edge itself: whatever distance the pattern
  // reports under the cursor is the lever position that puts the boundary there.
  const set = (e: PointerEvent<HTMLDivElement>) => {
    if (shape !== undefined) {
      const { u, v } = uvIn(e.currentTarget, e.clientX, e.clientY)
      const p = shape.pos(u, v)
      props.onChange(Math.min(1, Math.max(0, p + snapOffset([p], !e.altKey))))
    }
  }
  return (
    <div className={styles.wrap}>
      <div
        className={cx(styles.frame, props.inert && styles.inert)}
        title={
          props.inert
            ? 'no wipe pattern selected — the boundary is not on air'
            : 'drag the boundary · alt drags off the guides'
        }
        style={{ cursor: shape === undefined ? 'default' : 'crosshair' }}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          set(e)
        }}
        onPointerMove={e => {
          if (dragging) set(e)
        }}
        onPointerUp={e => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          setDragging(false)
        }}
        onPointerCancel={() => setDragging(false)}
      >
        {shape === undefined ? null : (
          <div className={styles.region} style={shape.box(props.pos)} />
        )}
        <span className={cx(styles.side, styles.sideA)}>A</span>
        {shape === undefined ? null : (
          <span className={cx(styles.side, styles.sideB)}>B</span>
        )}
      </div>
      <div className={styles.readout}>
        <span>drag the boundary</span>
        <span className={styles.nums}>{props.pos.toFixed(3)}</span>
      </div>
    </div>
  )
}
