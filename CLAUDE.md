# Phosphene

Real-time NTSC signal-path simulator rendered entirely in WebGPU compute shaders.

## Testing WebGPU (Linux)

On Linux, test WebGPU with **Firefox Nightly** (`/usr/bin/firefox-nightly`), not Chrome.
Chrome's ANGLE/Vulkan backend on Linux reports spurious texture-allocation errors
(e.g. "Requested allocation size … is smaller than the image requires") that are
driver artifacts, not app bugs. The `scripts/shot.mjs` harness already launches
Firefox Nightly with the right prefs — model new harnesses on it.
