// Frame-store write for the mixer loop: plain capture, or an analog trail
// keyer — compare luma envelopes (a 4-sample boxcar spans one subcarrier
// cycle, nulling chroma) and switch the whole composite, so trails keep
// their chroma and fade with it. Strobe skips this dispatch, holding the
// last capture. Neighbor reads of prev during the write dispatch can see a
// mix of old and new values; that only jitters the switch decision by a
// sample, like a real comparator near threshold.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> comp: array<f32>;
@group(0) @binding(2) var<storage, read_write> prev: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  let row = gid.y;
  if (s >= SPL || row >= NLINES) {
    return;
  }
  let n = row * SPL + s;
  var cap = comp[n];
  if (P.cfbTrail > 0.0) {
    var lc = 0.0;
    var lp = 0.0;
    for (var k = -1; k <= 2; k = k + 1) {
      let i = clampIdx(i32(n) + k);
      lc = lc + comp[i];
      lp = lp + prev[i];
    }
    cap = select(prev[n] * P.cfbTrail, comp[n], lc + 2.0 >= lp * P.cfbTrail);
  }
  prev[n] = cap;
}
