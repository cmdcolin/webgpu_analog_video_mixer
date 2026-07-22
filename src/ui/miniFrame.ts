export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// Guides a drag settles onto: edges, center, thirds, quarters.
const GUIDES = [0, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1]
const SNAP = 0.012

// Smallest correction that lands one of the dragged reference points on a
// guide — zero when nothing is near, or when the drag asked for precision.
export const snapOffset = (points: number[], on: boolean) => {
  let best = 0
  if (on) {
    let err = SNAP
    for (const p of points) {
      for (const g of GUIDES) {
        if (Math.abs(g - p) < err) {
          err = Math.abs(g - p)
          best = g - p
        }
      }
    }
  }
  return best
}

export const uvIn = (el: Element, clientX: number, clientY: number) => {
  const r = el.getBoundingClientRect()
  return {
    u: clamp01((clientX - r.left) / r.width),
    v: clamp01((clientY - r.top) / r.height),
  }
}
