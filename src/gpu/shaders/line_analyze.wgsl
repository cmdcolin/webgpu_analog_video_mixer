// Per-line burst measurement, done on the *degraded* signal — exactly what a
// real decoder's burst gate sees. Downstream hue lock, chroma AGC, and the
// color killer all key off this, so hue drift / color dropout are emergent.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> comp: array<f32>;
@group(0) @binding(2) var<storage, read> timing: array<f32>;
@group(0) @binding(3) var<storage, read_write> lineInfo: array<vec4f>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let row = gid.x;
  if (row >= NLINES) {
    return;
  }
  // the burst gate is keyed from the sync PLL, like the real burst gate
  let hoff = i32(round(timing[row]));
  var su = 0.0;
  var sv = 0.0;
  var cnt = 0.0;
  for (var s = BURST_START + 2u; s < BURST_START + BURST_LEN - 2u; s = s + 1u) {
    let n = clampIdx(i32(row * SPL + s) + hoff);
    let sc = carrier(n, P.frame);
    su = su + comp[n] * sc.x;
    sv = sv + comp[n] * sc.y;
    cnt = cnt + 1.0;
  }
  let mu = 2.0 * su / cnt;
  let mv = 2.0 * sv / cnt;
  lineInfo[row] = vec4f(mu, mv, sqrt(mu * mu + mv * mv), 0.0);
}
