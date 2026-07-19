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

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  // roll wraps over the whole 525-line frame, so the VBI decodes as the
  // classic rolling black bar instead of the picture wrapping seamlessly
  let vroll = timing[525u];
  let row = (ACTIVE_TOP + gid.y + u32(vroll)) % NLINES;
  let hoff = i32(round(timing[row]));
  let s = ACTIVE_START + gid.x;
  let n = clampIdx(i32(row * SPL + s) + hoff);

  if (P.dbgView == 2.0) {
    let sn = (u32(f32(gid.x) / f32(ACTIVE_W) * f32(SPL))) + row * SPL;
    let gray = (comp[sn] + 40.0) / 140.0;
    textureStore(outTex, vec2i(gid.xy), vec4f(vec3f(gray), 1.0));
    return;
  }

  let m = i32((P.demodTaps - 1u) / 2u);
  var us = 0.0;
  var vs = 0.0;
  for (var k = 0u; k < P.demodTaps; k = k + 1u) {
    let ni = clampIdx(i32(n) + i32(k) - m);
    let c = csrc(ni);
    let sc = carrier(ni, P.frame);
    let h = filters[SEC_DEMOD * FILTER_STRIDE + k];
    us = us + h * c * sc.x;
    vs = vs + h * c * sc.y;
  }
  // receiver AGC: IF gain ahead of the demod, so luma, chroma, and black
  // level all pump together when sync depth is mismeasured
  let gif = mix(1.0, timing[527u], P.agc);
  us = us * 2.0 * gif;
  vs = vs * 2.0 * gif;

  let sc0 = carrier(n, P.frame);
  let lum = comp[n] * gif - (us * sc0.x + vs * sc0.y);

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
  textureStore(outTex, vec2i(gid.xy), vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0));
}
