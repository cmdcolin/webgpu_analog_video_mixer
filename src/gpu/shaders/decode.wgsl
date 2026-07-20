// Composite decoder: deflection follows the sync PLL (timing buffer), chroma
// demodulated synchronously against the exact subcarrier lattice, Y/C
// separation selectable (chroma trap / 2-line comb / 3-line comb), hue and
// gain referenced to the measured burst. Residual subcarrier at color edges
// IS the dot crawl; comb modes trade it for hanging dots, authentically.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> filters: array<f32>;
@group(0) @binding(2) var<storage, read> comp: array<f32>;
@group(0) @binding(3) var<storage, read> lineInfo: array<vec4f>;
@group(0) @binding(4) var<storage, read> timing: array<f32>;
@group(0) @binding(5) var outTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(6) var<storage, read_write> persist: array<u32>;
@group(0) @binding(7) var<storage, read> audio: array<f32>;

// chroma-path source per Y/C separation mode
fn csrc(i: u32) -> f32 {
  if (P.combMode < 0.5) {
    return comp[i];
  }
  let up = comp[clampIdx(i32(i) - i32(SPL))];
  if (P.combMode < 1.5) {
    return 0.5 * (comp[i] - up);
  }
  let dn = comp[clampIdx(i32(i) + i32(SPL))];
  return 0.5 * comp[i] - 0.25 * (up + dn);
}

// Deflection-domain bend: distortion of the tube's own horizontal scan, so it
// is a function of the *screen* row, not the source row. Two consequences, both
// wanted: a rolling picture slides through a bend that stays put on the glass,
// and because the burst gate (line_analyze) keys off sync alone, a bent yoke
// bends the picture without spinning hue — unlike a sync error, which does.
fn bendAt(y: f32) -> f32 {
  let t = y / f32(ACTIVE_H);
  let per = max(P.bendPeriod, 1.0);
  var s = 0.0;
  if (P.bendShape < 0.5) {
    s = exp(-y / per); // flag: hooks the top lines, dies away down the picture
  } else if (P.bendShape < 1.5) {
    s = t; // skew: the whole raster leans
  } else if (P.bendShape < 2.5) {
    s = sin(PI * t); // bow: pinned top and bottom, bulging at the middle
  } else {
    s = sin(2.0 * PI * y / per); // ripple
  }
  return P.bendAmt * s;
}

// comb-filtered chroma source span for this workgroup's row; a whole
// workgroup shares one raster row (and its sync offset), so the demod FIR
// reads shared memory instead of 1-3 storage loads per tap
var<workgroup> tile: array<f32, TILE>;

// synchronous chroma demod centered on tile index ti / global sample n0.
// Offsets stay within the halo for |off| <= HALO - (DEMOD_TAPS-1)/2.
fn demodAt(ti: i32, n0: i32) -> vec2f {
  let m = i32((DEMOD_TAPS - 1u) / 2u);
  var us = 0.0;
  var vs = 0.0;
  for (var k = 0; k < i32(DEMOD_TAPS); k = k + 1) {
    let c = tile[u32(ti + k - m)];
    let sc = carrier(clampIdx(n0 + k - m), P.frame);
    let h = filters[SEC_DEMOD * FILTER_STRIDE + u32(k)];
    us = us + h * c * sc.x;
    vs = vs + h * c * sc.y;
  }
  return vec2f(us, vs);
}

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  // roll wraps over the whole 525-line frame, so the VBI decodes as the
  // classic rolling black bar instead of the picture wrapping seamlessly
  let vroll = timing[525u];
  let row = wrapRow(i32(ACTIVE_TOP + gid.y) + i32(floor(vroll)));
  // parametric bend, the signal-driven supply sag, and audio patched straight
  // at the yoke — all deflection-domain, all indexed by raster line
  let ry = ACTIVE_TOP + gid.y;
  let sag = P.hvSag * timing[SAG_BASE + ry];
  let hoff = i32(round(timing[row] + bendAt(f32(gid.y)) + sag + P.audioBend * audio[ry]));
  let base = i32(row * SPL + ACTIVE_START + wid.x * 64u) + hoff - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + 64u) {
    tile[i] = csrc(clampIdx(base + i32(i)));
  }
  workgroupBarrier();

  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  let s = ACTIVE_START + gid.x;
  let n = clampIdx(i32(row * SPL + s) + hoff);

  if (P.dbgView == 2.0) {
    let sn = (u32(f32(gid.x) / f32(ACTIVE_W) * f32(SPL))) + row * SPL;
    let gray = (comp[sn] + 40.0) / 140.0;
    textureStore(outTex, vec2i(gid.xy), vec4f(vec3f(gray), 1.0));
    return;
  }

  // Chroma reconstruction lattice: at coarse > 1 the demod runs only at every
  // coarse-th sample and pixels between get linear interpolation — the digital
  // decoder's chroma-upsampling error. Interpolated U/V re-attach to the wrong
  // subcarrier phase at edges, blooming dither and fine detail into rainbows.
  // Factor 8 keeps the farthest tap within the tile halo (20 + 8 <= 32).
  let ti = i32(lid.x + HALO);
  let coarse = u32(clamp(P.chromaCoarse, 1.0, 8.0));
  var uvd: vec2f;
  if (coarse > 1u) {
    let x0 = (gid.x / coarse) * coarse;
    let d0 = i32(x0) - i32(gid.x);
    let a = demodAt(ti + d0, i32(n) + d0);
    let b = demodAt(ti + d0 + i32(coarse), i32(n) + d0 + i32(coarse));
    uvd = mix(a, b, f32(gid.x - x0) / f32(coarse));
  } else {
    uvd = demodAt(ti, i32(n));
  }
  var us = uvd.x;
  var vs = uvd.y;
  // receiver AGC: IF gain ahead of the demod, so luma, chroma, and black
  // level all pump together when sync depth is mismeasured
  let gif = mix(1.0, timing[527u], P.agc);
  us = us * 2.0 * gif;
  vs = vs * 2.0 * gif;

  let sc0 = carrier(n, P.frame);
  // S-video miswire: the chroma trap normally subtracts reconstructed chroma to
  // recover clean luma. Cross-wiring the Y and C pins bleeds the color
  // subcarrier back into brightness — at 0.5 the trap is defeated (raw
  // composite as luma, dot crawl everywhere), past it the chroma re-adds and
  // the subcarrier crawls as a herringbone while colored detail smears into Y.
  let chromaRecon = us * sc0.x + vs * sc0.y;
  let lum = comp[n] * gif - chromaRecon * (1.0 - 2.0 * P.svideoBleed);

  // burst lock: hue from burst phase error, gain from burst amplitude (ACC),
  // color killer when burst is gone
  let li = lineInfo[row];
  let locked = li.z > P.killThresh;
  // phase error measured about the expected 180 degrees: negating the burst
  // components keeps the angle wrapped near zero, so a partial burstLock
  // scales a continuous error instead of jumping a 2*pi branch on noise
  let e = select(0.0, atan2(-li.y, -li.x), locked) * P.burstLock;
  let acc = select(0.0, clamp(BURST_AMP / max(li.z, 0.5), 0.0, 4.0), locked);
  let g = mix(1.0, acc, P.burstLock) * P.chromaGain;

  let ce = cos(e);
  let se = sin(e);
  let ur = (us * ce + vs * se) * g;
  let vr = (-us * se + vs * ce) * g;

  if (P.dbgView == 3.0) {
    textureStore(outTex, vec2i(gid.xy), vec4f(vec3f((lum - IRE_BLACK) / VIDEO_RANGE), 1.0));
    return;
  }
  if (P.dbgView == 4.0) {
    textureStore(outTex, vec2i(gid.xy), vec4f(abs(us) / 40.0, abs(vs) / 40.0, 0.0, 1.0));
    return;
  }
  if (P.dbgView == 5.0) {
    textureStore(outTex, vec2i(gid.xy), vec4f(li.z / 40.0, abs(e) / PI, g / 2.0, 1.0));
    return;
  }

  let yn = (lum - IRE_BLACK) / VIDEO_RANGE;
  let un = ur / VIDEO_RANGE;
  let vn = vr / VIDEO_RANGE;
  let rgb = vec3f(
    yn + 1.140 * vn,
    yn - 0.395 * un - 0.581 * vn,
    yn + 2.032 * un,
  );
  // P22 phosphor persistence: peak-hold against the decaying previous screen.
  // Green phosphor lingers longest, blue dies first, so trails go green-ish.
  // Lives on outTex (not in present) so the camera-feedback loop films a
  // persisting screen, as a real camera-at-monitor rig would.
  // Hue-preserving gamut fit instead of a per-channel clamp: saturated content
  // stays vivid at the clipping point rather than rotating hue toward whatever
  // channel didn't overflow. crt_face works in the headroom this leaves.
  var outc = gamutFit(rgb);
  let pi = gid.y * ACTIVE_W + gid.x;
  if (P.phosphor > 0.0) {
    let g = min(P.phosphor, 0.98);
    let decay = vec3f(pow(g, 1.7), g, pow(g, 2.4));
    outc = max(outc, unpack4x8unorm(persist[pi]).rgb * decay);
  }
  persist[pi] = pack4x8unorm(vec4f(outc, 1.0));
  textureStore(outTex, vec2i(gid.xy), vec4f(outc, 1.0));
}
