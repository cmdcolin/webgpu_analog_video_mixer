// VHS color-under, record side: heterodyne the chroma from fsc down to
// 629 kHz and lowpass — the severe bandwidth loss of the color-under system.
// lineParams.y carries the per-line heterodyne base phase (accumulated in f64
// on the CPU; f32 cannot hold the running phase).

@group(0) @binding(0) var<storage, read> filters: array<f32>;
@group(0) @binding(1) var<storage, read> chroma: array<f32>;
@group(0) @binding(2) var<storage, read> lineParams: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> under: array<f32>;

fn cosDown(row: u32, s: f32) -> f32 {
  return cos(lineParams[row].y + 2.0 * PI * fract(DOWN_PER_SAMPLE * s));
}

var<workgroup> tile: array<f32, TILE>;

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let row = wid.y;
  let base = i32(row * SPL + wid.x * 64u) - i32(HALO);
  for (var i = lid.x; i < TILE; i = i + 64u) {
    tile[i] = chroma[clampIdx(base + i32(i))];
  }
  workgroupBarrier();

  let s = gid.x;
  if (s >= SPL) {
    return;
  }
  let m = (UNDER_TAPS - 1u) / 2u;
  var acc = 0.0;
  for (var k = 0u; k < UNDER_TAPS; k = k + 1u) {
    let si = i32(s) + i32(k) - i32(m);
    acc = acc + filters[SEC_UNDER * FILTER_STRIDE + k] * tile[lid.x + HALO + k - m] * 2.0 * cosDown(row, f32(si));
  }
  under[row * SPL + s] = acc;
}
