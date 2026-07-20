# Phosphene

Real-time NTSC signal-path simulator rendered entirely in WebGPU compute
shaders.

## Read first

**`agent-docs/ARCHITECTURE.md`** — read it before changing anything non-trivial.
It covers the pass graph, buffer layouts, how to add a control end to end, and
the two invariants that are easiest to violate:

- **Which domain an effect belongs to.** A horizontal displacement means
  something different in the signal, sync, and deflection domains — they are not
  interchangeable, and routing a geometry fault through the sync path will spin
  hue that should have stayed put.
- **`decode` stages a shared tile per row**, so horizontal offsets must be
  row-uniform. Per-pixel horizontal scaling needs the staging restructured first.

Prefer modelling the mechanism that causes an artifact over drawing the artifact
— that is the whole premise, and it is why mechanisms here interact for free.

## Testing WebGPU (Linux)

On Linux, test WebGPU with **Firefox Nightly** (`/usr/bin/firefox-nightly`), not
Chrome. Chrome's ANGLE/Vulkan backend on Linux reports spurious
texture-allocation errors (e.g. "Requested allocation size … is smaller than the
image requires") that are driver artifacts, not app bugs. The `scripts/shot.mjs`
harness already launches Firefox Nightly with the right prefs — model new
harnesses on it.
