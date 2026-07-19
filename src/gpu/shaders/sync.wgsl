// Sync flywheel PLL + vertical hold + AGC — the TV side of horizontal and
// vertical hold. Line tearing, head-switch bend, and vertical rolling all
// emerge from sync pulses being genuinely hard to find in the mangled
// waveform. The waveform itself is scanned in parallel by sync_measure; this
// single thread only runs the line-to-line recurrences over those
// measurements.
//
// timing[0..524]  per-line horizontal offset the deflection actually used
// timing[525]     vertical roll offset (persistent)
// timing[526]     PLL state (persistent)
// timing[527]     AGC gain state (persistent): IF gain normalizing the
//                 measured sync-tip depth to 40 IRE, slewed per frame

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> measure: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> timing: array<f32>;

@compute @workgroup_size(1, 1, 1)
fn main() {
  var pll = timing[526u];
  var vroll = timing[525u];

  // vertical sync check: broad pulses should sit at sync level mid-line
  var vscore = 0.0;
  for (var r = VSYNC_FIRST; r <= VSYNC_LAST; r = r + 1u) {
    vscore = vscore + measure[r].w;
  }
  if (P.vHold > 0.0) {
    if (vscore < 3.0) {
      vroll = vroll + 3.0 + 40.0 * rand01(pcg(P.frame * 719u));
    } else {
      // pull back into lock
      vroll = vroll * (1.0 - 0.35 * P.vHold);
      if (abs(vroll) < 0.6) {
        vroll = 0.0;
      }
    }
    vroll = vroll % f32(NLINES);
  } else {
    vroll = 0.0;
  }

  var depthSum = 0.0;
  var depthCount = 0.0;
  for (var row = 0u; row < NLINES; row = row + 1u) {
    let m = measure[row];
    if (m.x > -999.0) {
      // flywheel: blend measurement in at the hold gain
      pll = pll + P.hHold * (m.x - pll);
      // gated AGC depth on picture lines
      if (row > VSYNC_LAST + 3u) {
        depthSum = depthSum + m.y;
        depthCount = depthCount + 1.0;
      }
    } else {
      // free-run with slight drift when sync is lost
      pll = pll + 0.15 * (rand01(pcg(row * 7919u + P.frame * 104729u)) - 0.45);
    }
    timing[row] = pll;
  }

  var agc = timing[527u];
  if (agc < 0.05) {
    agc = 1.0;
  }
  if (depthCount > 0.0) {
    let want = 40.0 / clamp(depthSum / depthCount, 5.0, 160.0);
    agc = agc + 0.25 * (want - agc);
  }

  timing[525u] = vroll;
  timing[526u] = pll;
  timing[527u] = clamp(agc, 0.25, 4.0);
}
