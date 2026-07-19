// Dirty mixer: source B is a second, fully-formed NTSC generator that is NOT
// genlocked to A. Its line timing slips and skews (line-frequency offset), its
// frame rolls (field-rate offset), and its subcarrier is detuned off the
// sampling lattice. The two composites are summed (optionally ring-modulated)
// BEFORE the channel, sync separator, and burst measurement — so fighting
// sync, rolling bars, tilted tears, and chroma beat patterns all emerge
// downstream instead of being painted.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var<storage, read> yuvB: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> comp: array<f32>;

// the exact-lattice carrier rotated by B's slow detune/slip phase
fn carrierB(n: u32, delta: f32) -> vec2f {
  let sc = carrier(n, P.frame);
  let cd = cos(delta);
  let sd = sin(delta);
  return vec2f(sc.x * cd + sc.y * sd, sc.y * cd - sc.x * sd);
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;

  // B's raster position for this output sample: accumulated horizontal slip
  // plus per-line skew, and vertical roll
  let spl = f32(SPL);
  let sp = f32(s) + P.bShift0 + P.bShiftLine * f32(row);
  let su = sp - floor(sp / spl) * spl;
  let si = u32(su);
  let frac = su - f32(si);
  let srow = (row + u32(P.bRowOff)) % NLINES;
  let np = srow * SPL + si;
  // subcarrier detune accumulates over lines; a fractional-sample slip is
  // 90 degrees per sample off the lattice; the proc-amp hue trim adds on top
  let delta = P.bHue + P.bPhase0 + P.bPhaseLine * f32(row) + 0.5 * PI * frac;

  // generate B's composite at (srow, su) — same structure as the encoder
  var b = IRE_BLANK;
  if (srow < VSYNC_FIRST || (srow > VSYNC_LAST && srow < 12u)) {
    b = select(IRE_BLANK, IRE_SYNC, (si % 455u) < 33u);
  } else if (srow >= VSYNC_FIRST && srow <= VSYNC_LAST) {
    let serration = (si >= 430u && si < 498u) || si >= 880u;
    b = select(IRE_SYNC, IRE_BLANK, serration);
  } else if (si < SYNC_LEN) {
    b = IRE_SYNC;
  } else if (si >= BURST_START && si < BURST_START + BURST_LEN && srow > VSYNC_LAST + 1u) {
    b = -BURST_AMP * carrierB(np, delta).x;
  } else if (si >= ACTIVE_START && si < ACTIVE_START + ACTIVE_W && srow >= ACTIVE_TOP && srow < ACTIVE_TOP + ACTIVE_H) {
    let m = i32((P.encChromaTaps - 1u) / 2u);
    var uf = 0.0;
    var vf = 0.0;
    for (var k = 0u; k < P.encChromaTaps; k = k + 1u) {
      let idx = clampIdx(i32(np) + i32(k) - m);
      let h = filters[SEC_ENC_CHROMA * FILTER_STRIDE + k];
      uf = uf + h * yuvB[idx].y;
      vf = vf + h * yuvB[idx].z;
    }
    let sc = carrierB(np, delta);
    // proc amp: video gain around the pedestal, continuous inversion
    // (0.5 collapses to the solarized midpoint, 1 fully inverts)
    b = IRE_BLACK + VIDEO_RANGE * (yuvB[np].x + uf * sc.x + vf * sc.y) * P.bVidGain;
    b = mix(b, 107.5 - b, P.bInv);
  }

  // wipe pattern generator, running on the output (house) raster. A switcher
  // only switches during active picture — blanking stays on the program bus —
  // so an engaged wipe excludes B's sync and burst; wipe off is the hardwired
  // dirty sum, blanking and all.
  var gate = 1.0;
  if (P.wipeMode > 0.5) {
    let u = (f32(s) - f32(ACTIVE_START)) / f32(ACTIVE_W);
    let v = (f32(row) - f32(ACTIVE_TOP)) / f32(ACTIVE_H);
    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
      gate = 0.0;
    } else {
      var d = P.wipePos - u;
      if (P.wipeMode > 1.5 && P.wipeMode < 2.5) {
        d = P.wipePos - v;
      } else if (P.wipeMode > 2.5 && P.wipeMode < 3.5) {
        d = P.wipePos - max(abs(u - 0.5), abs(v - 0.5)) * 2.0;
      } else if (P.wipeMode > 3.5) {
        d = P.wipePos - (abs(u - 0.5) + abs(v - 0.5));
      }
      gate = smoothstep(-max(P.wipeSoft, 0.002), max(P.wipeSoft, 0.002), d);
    }
  }

  // sum at the composite level; ring mod multiplies the two signals
  let a = comp[n];
  comp[n] = a + gate * (P.bGain * b + P.bRing * a * b * 0.01);
}
